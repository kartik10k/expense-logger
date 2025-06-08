import http.server
import socketserver
import os
import sys

PORT = 8000

def load_secrets():
    try:
        from local_secrets import HUGGINGFACE_API_KEY
        print("✓ Successfully loaded Hugging Face token from local_secrets.py")
        return HUGGINGFACE_API_KEY
    except ImportError:
        print("Error: local_secrets.py not found!")
        print("Please create local_secrets.py with your Hugging Face token:")
        print("HUGGINGFACE_API_KEY = 'your-token-here'")
        sys.exit(1)
    except Exception as e:
        print(f"Error loading secrets: {e}")
        sys.exit(1)

# Load the token
HUGGINGFACE_API_KEY = load_secrets()

# Create config.js with the token
config_content = f"""// Configuration for the Expense Logger app
const config = {{
    HUGGINGFACE: {{
        API_KEY: '{HUGGINGFACE_API_KEY}',
        MODEL: 'mistralai/Mistral-7B-Instruct-v0.2',
        MAX_RETRIES: 3,
        RATE_LIMIT_COOLDOWN: 60000,
    }},
    APP: {{
        VERSION: '1.0.0',
        CACHE_KEY: 'classificationCache',
    }}
}};
window.appConfig = config;"""

try:
    # Write config.js
    with open('config.js', 'w') as f:
        f.write(config_content)
    print("✓ Successfully created config.js")
except Exception as e:
    print(f"Error creating config.js: {e}")
    sys.exit(1)

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add CORS headers
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        # Custom logging to show requests
        print(f"Request: {args[0]} {args[1]} {args[2]}")

try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"\n🚀 Server running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server\n")
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n👋 Server stopped")
except Exception as e:
    print(f"\nError starting server: {e}")
    sys.exit(1) 