# Tlink AI Proxy Server

This is a standalone proxy server that routes AI requests to various providers, allowing you to:
- Share API keys across users (without exposing them)
- Implement rate limiting
- Manage costs centrally
- Offer premium tiers

## Architecture

```
User's Tlink App → Your Proxy Server → AI Provider APIs (Groq, OpenAI, etc.)
```

## Quick Start

1. **Install dependencies:**
   ```bash
   cd proxy-server
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

   Multiple keys per provider are supported (comma-separated):
   ```
   GROQ_API_KEYS=key1,key2
   OPENAI_API_KEYS=key1,key2
   ANTHROPIC_API_KEYS=key1,key2
   ```
   If you set both `*_API_KEY` and `*_API_KEYS`, all keys are used.

   Override default models (optional):
   ```
   GROQ_DEFAULT_MODEL=llama-3.1-8b-instant
   OPENAI_DEFAULT_MODEL=gpt-4o-mini
   ANTHROPIC_DEFAULT_MODEL=claude-3-sonnet-20240229
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Update Tlink config:**
   - Point `baseURL` to your proxy server URL
   - Users don't need API keys anymore!

## Deployment Options

- **Local development:** `http://localhost:3000`
- **Cloud:** Deploy to Heroku, Railway, Render, AWS, etc.
- **Docker:** Use provided Dockerfile
