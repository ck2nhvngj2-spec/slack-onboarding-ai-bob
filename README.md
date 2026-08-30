# Slack Onboarding AI: IBM Bob & ChromaDB Integration

An intelligent, context-aware Slack chatbot designed to automate engineering onboarding and handle technical queries. Built with a Retrieval-Augmented Generation (RAG) architecture, this system leverages IBM Bob 2.0 for cognitive processing and ChromaDB for vector-based semantic search.

## System Architecture

* **Cognitive Engine:** IBM Bob 2.0 API handles natural language understanding and response generation.
* **Vector Database:** ChromaDB maintains the embedding space for context retrieval, allowing the bot to query internal documentation.
* **Integration Layer:** Built with the Slack Bolt framework (TypeScript/Node.js) using WebSocket connections (Socket Mode) for real-time, secure communication without public endpoints.
* **Session Management:** In-memory tracking isolates user sessions via Slack user IDs, ensuring context is maintained per user across different channels.

## Key Features

* **Intelligent Escalation:** Uses a strict `CONFIDENCE_THRESHOLD` (default: 0.65). If the cognitive engine's confidence falls below this metric, the system elegantly escalates the query rather than hallucinating.
* **Threaded Responses:** Automatically replies in-thread using Slack Block Kit to prevent channel clutter, tracking `thread_ts` to maintain conversation continuity.
* **Seamless Local Deployment:** Containerized and configured for rapid local testing using environment variables.

## Quick Start Setup

**1. Clone the repository**
```bash
git clone [https://github.com/ck2nhvngj2-spec/slack-onboarding-ai-bob.git](https://github.com/ck2nhvngj2-spec/slack-onboarding-ai-bob.git)
cd slack-onboarding-ai-bob
```

**2. Install dependencies**
```bash
npm install
```

**3. Configure Environment Variables**
Create a `.env` file in the root directory based on the provided `.env.example`:
```env
# Slack Authentication
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret

# Cognitive Engine & Database
BOB_API_KEY=your-ibm-bob-api-key
CHROMA_DB_URL=http://localhost:8000
CONFIDENCE_THRESHOLD=0.65
```

**4. Run the application**
```bash
npm run dev
```

## Usage
Once the WebSocket connection is established, mention the bot in any Slack channel it is invited to (e.g., `@OnboardingBot How do I start the ChromaDB instance?`). The bot will evaluate the query, retrieve relevant system context, and reply directly in a thread.