import os
import logging
import secrets
import time
import pathlib
import json
import asyncio
from collections import deque
from threading import Lock

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session
from fastmcp import Client as MCPClient
from openai import OpenAI

load_dotenv()

# --------------------------------------------------
# Flask configuration
# --------------------------------------------------

app = Flask(__name__)

app.secret_key = (
    os.getenv("FLASK_SECRET_KEY")
    or secrets.token_hex(32)
)

app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=(
        os.getenv("COOKIE_SECURE", "false").lower() == "true"
    ),
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --------------------------------------------------
# NVIDIA (OpenAI SDK) configuration
# --------------------------------------------------

API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()

MODEL_NAME = os.getenv(
    "NVIDIA_MODEL",
    "nvidia/nemotron-3.5-super-vl-120b-a12b"
).strip()

nvidia_client = (
    OpenAI(
        base_url="https://integrate.api.nvidia.com/v1",
        api_key=API_KEY,
        timeout=60.0,
    )
    if API_KEY else None
)

# --------------------------------------------------
# MCP configuration
# --------------------------------------------------

MCP_SERVER_PATH = pathlib.Path(__file__).parent / "time_server.py"

# --------------------------------------------------
# Conversation settings
# --------------------------------------------------

MAX_MESSAGE_LENGTH = 2000
MAX_HISTORY_MESSAGES = 12
CONVERSATION_TTL_SECONDS = 3600

conversations = {}
conversation_lock = Lock()

# --------------------------------------------------
# Customer service system prompt
# --------------------------------------------------

SYSTEM_INSTRUCTIONS = """
You are a professional, friendly customer care chatbot
created for educational and demonstration purposes.


TOOLS:
- You have access to a real-time clock tool called get_current_time.
- Use it whenever the user asks about the current time or date.
- Never guess or invent the current time or date.

FORMATTING RULES:
- Always respond in clean, plain text.
- Never use Markdown formatting.
- Do not use ** for bold text.
- Do not use * for italic text.
- Do not use Markdown headings or code blocks.
- Use simple paragraphs and numbered lists when necessary.
- Responses should look natural in a customer service chat interface.
"""

# --------------------------------------------------
# MCP helpers
# --------------------------------------------------

_SCHEMA_STRIP_KEYS = {
    "additionalProperties", "$schema", "$id", "$defs",
    "definitions", "title", "examples", "default",
}

def _clean_schema(schema):
    if isinstance(schema, dict):
        return {
            k: _clean_schema(v)
            for k, v in schema.items()
            if k not in _SCHEMA_STRIP_KEYS
        }
    if isinstance(schema, list):
        return [_clean_schema(item) for item in schema]
    return schema

def _get_tool_schema(t):
    schema = getattr(t, "input_schema", None)
    if schema is None:
        schema = getattr(t, "inputSchema", None)
    return schema or {"type": "object", "properties": {}}

async def _list_mcp_tools():
    async with MCPClient(MCP_SERVER_PATH) as mcp_client:
        return await mcp_client.list_tools()

async def _call_mcp_tool(tool_name, arguments):
    async with MCPClient(MCP_SERVER_PATH) as mcp_client:
        result = await mcp_client.call_tool(tool_name, arguments)
        return result.text if hasattr(result, "text") else str(result)

def _mcp_tools_to_nvidia(mcp_tools):
    declarations = []
    for t in mcp_tools:
        declarations.append({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description or "",
                "parameters": _clean_schema(_get_tool_schema(t))
            }
        })
    return declarations

# --------------------------------------------------
# NVIDIA + MCP call loop
# --------------------------------------------------

async def generate_with_mcp(messages_history):
    mcp_tools = await _list_mcp_tools()
    nvidia_tools = _mcp_tools_to_nvidia(mcp_tools)

    def _call():
        return nvidia_client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages_history,
            temperature=0.3,
            top_p=0.95,
            max_tokens=1024,
            tools=nvidia_tools if nvidia_tools else None,
            parallel_tool_calls=True,
            seed=42,
            stream=False,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}} # OFF to save memory and time
        )

    response = await asyncio.to_thread(_call)
    message = response.choices[0].message

    for _ in range(3):
        if not message.tool_calls:
            break

        messages_history.append(message)

        for tool_call in message.tool_calls:
            fn_name = tool_call.function.name
            fn_args = json.loads(tool_call.function.arguments)
            
            try:
                result_text = await _call_mcp_tool(fn_name, fn_args)
            except Exception as exc:
                logger.exception("MCP tool call failed: %s", fn_name)
                result_text = f"Tool error: {exc}"

            messages_history.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result_text
            })

        def _follow_up():
            return nvidia_client.chat.completions.create(
                model=MODEL_NAME,
                messages=messages_history,
                temperature=0.3,
                top_p=0.95,
                max_tokens=1024,
                tools=nvidia_tools if nvidia_tools else None,
                parallel_tool_calls=True,
                seed=42,
                stream=False,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}}
            )

        response = await asyncio.to_thread(_follow_up)
        message = response.choices[0].message

    return message.content or ""

# --------------------------------------------------
# Routes
# --------------------------------------------------

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/health")
def health():
    return jsonify({"status": "ok", "api_configured": bool(nvidia_client)})

@app.post("/api/chat")
def chat():
    if nvidia_client is None:
        return jsonify({"error": "NVIDIA API key missing."}), 503

    data = request.get_json(silent=True)
    message = data.get("message", "").strip() if data else ""
    
    if not message:
        return jsonify({"error": "Please enter a message."}), 400

    if "conversation_id" not in session:
        session["conversation_id"] = secrets.token_urlsafe(32)

    # Build message history
    messages_history = [{"role": "system", "content": SYSTEM_INSTRUCTIONS}]
    messages_history.append({"role": "user", "content": message})

    try:
        # Using asyncio.run directly, no background thread
        answer = asyncio.run(generate_with_mcp(messages_history))
        return jsonify({"reply": answer.strip()})
    except Exception as exc:
        logger.exception("Chat error")
        return jsonify({"error": str(exc)}), 500

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000)