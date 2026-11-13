const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const messagesContainer = document.getElementById("chat-messages");
const sendButton = document.getElementById("send-button");
const resetButton = document.getElementById("reset-button");
const errorBanner = document.getElementById("error-banner");

let isSending = false;
let typingRow = null;

// Check that the required HTML elements exist.
if (!chatForm || !messageInput || !messagesContainer || !sendButton || !resetButton) {
    console.error("Chatbot initialization failed. Check your HTML element IDs.");
} else {

    // -----------------------------------------
    // ERROR HANDLING
    // -----------------------------------------

    function showError(message) {
        errorBanner.textContent = message;
        errorBanner.hidden = false;
    }

    function clearError() {
        errorBanner.textContent = "";
        errorBanner.hidden = true;
    }

    // -----------------------------------------
    // CHAT DISPLAY
    // -----------------------------------------

    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function hideWelcome() {
        const welcome = messagesContainer.querySelector(".welcome");

        if (welcome) {
            welcome.remove();
        }
    }

    function addMessage(role, text) {
        hideWelcome();

        const isUser = role === "user";

        const row = document.createElement("div");
        row.className = `message ${isUser ? "user" : "assistant"}`;

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = isUser ? "Y" : "S";

        const bubble = document.createElement("div");
        bubble.className = "message-content";
        bubble.textContent = text;

        row.append(avatar, bubble);
        messagesContainer.appendChild(row);

        scrollToBottom();
    }

    // -----------------------------------------
    // TYPING INDICATOR
    // -----------------------------------------

    function showTyping() {
        hideWelcome();

        typingRow = document.createElement("div");
        typingRow.className = "message assistant";

        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = "S";

        const indicator = document.createElement("div");
        indicator.className = "typing-indicator";

        for (let i = 0; i < 3; i++) {
            const dot = document.createElement("span");
            indicator.appendChild(dot);
        }

        typingRow.append(avatar, indicator);
        messagesContainer.appendChild(typingRow);

        scrollToBottom();
    }

    function hideTyping() {
        if (typingRow) {
            typingRow.remove();
            typingRow = null;
        }
    }

    // -----------------------------------------
    // TEXTAREA RESIZING
    // -----------------------------------------

    function resizeInput() {
        messageInput.style.height = "auto";

        messageInput.style.height =
            `${Math.min(messageInput.scrollHeight, 130)}px`;
    }

    // -----------------------------------------
    // SEND MESSAGE TO FLASK
    // -----------------------------------------

    async function sendMessage(text) {
        if (isSending) return;

        const message = text.trim();

        if (!message) {
            messageInput.focus();
            return;
        }

        if (message.length > 2000) {
            showError("Your message cannot exceed 2,000 characters.");
            return;
        }

        clearError();
        addMessage("user", message);

        messageInput.value = "";
        resizeInput();

        isSending = true;
        sendButton.disabled = true;
        resetButton.disabled = true;
        messageInput.disabled = true;

        showTyping();

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    message: message
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Unable to get a response. Please try again."
                );
            }

            if (!data.reply || typeof data.reply !== "string") {
                throw new Error("The AI returned an empty response.");
            }

            hideTyping();
            addMessage("assistant", data.reply);

        } catch (error) {
            hideTyping();

            showError(
                error.message || "A network error occurred."
            );

        } finally {
            hideTyping();

            isSending = false;
            sendButton.disabled = false;
            resetButton.disabled = false;
            messageInput.disabled = false;

            messageInput.focus();
        }
    }

    // -----------------------------------------
    // FORM SUBMISSION
    // -----------------------------------------

    chatForm.addEventListener("submit", (event) => {
        event.preventDefault();
        sendMessage(messageInput.value);
    });

    messageInput.addEventListener("input", resizeInput);

    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chatForm.requestSubmit();
        }
    });

    // -----------------------------------------
    // SUGGESTION BUTTONS
    // -----------------------------------------

    document.querySelectorAll(".suggestion").forEach((button) => {
        button.addEventListener("click", () => {
            const message = button.dataset.message;

            if (message) {
                sendMessage(message);
            }
        });
    });

    // -----------------------------------------
    // RESET CONVERSATION
    // -----------------------------------------

    resetButton.addEventListener("click", async () => {
        if (isSending) return;

        clearError();
        resetButton.disabled = true;

        try {
            const response = await fetch("/api/reset", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({})
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not reset the conversation."
                );
            }

            hideTyping();
            messagesContainer.replaceChildren();

            // Recreate the original welcome screen.
            const welcome = document.createElement("div");
            welcome.className = "welcome";

            const orb = document.createElement("div");
            orb.className = "welcome-orb";

            const orbInner = document.createElement("span");
            orb.appendChild(orbInner);

            const eyebrow = document.createElement("p");
            eyebrow.className = "eyebrow";
            eyebrow.textContent = "YOUR AI SUPPORT ASSISTANT";

            const heading = document.createElement("h1");
            heading.append("How can we");

            const headingBreak = document.createElement("br");
            heading.appendChild(headingBreak);

            const headingSpan = document.createElement("span");
            headingSpan.textContent = "help you today?";
            heading.appendChild(headingSpan);

            const description = document.createElement("p");
            description.className = "welcome-description";
            description.textContent =
                "Have a question? Need assistance? Start a conversation and we'll help you find the answer.";

            const suggestions = document.createElement("div");
            suggestions.className = "suggestions";

            const suggestionData = [
                {
                    title: "Product information",
                    description: "Learn more about our products and services",
                    message: "Tell me about your products and services."
                },
                {
                    title: "Frequently asked questions",
                    description: "Get answers to common questions",
                    message: "What are some frequently asked questions?"
                },
                {
                    title: "Account assistance",
                    description: "Get help with your account",
                    message: "I need help with my account."
                },
                {
                    title: "Speak to support",
                    description: "Find out how to reach our support team",
                    message: "How can I speak to a support representative?"
                }
            ];

            suggestionData.forEach((item, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "suggestion";
                button.dataset.message = item.message;

                const icon = document.createElement("span");
                icon.className = "suggestion-icon";
                icon.textContent = ["↗", "?", "◎", "✳"][index];

                const textContainer = document.createElement("span");

                const title = document.createElement("strong");
                title.textContent = item.title;

                const description = document.createElement("small");
                description.textContent = item.description;

                textContainer.append(title, description);
                button.append(icon, textContainer);

                button.addEventListener("click", () => {
                    sendMessage(button.dataset.message);
                });

                suggestions.appendChild(button);
            });

            welcome.append(
                orb,
                eyebrow,
                heading,
                description,
                suggestions
            );

            messagesContainer.appendChild(welcome);

            messageInput.value = "";
            resizeInput();
            messageInput.focus();

        } catch (error) {
            showError(error.message || "Unable to reset the conversation.");

        } finally {
            resetButton.disabled = false;
        }
    });

    messageInput.focus();
}


