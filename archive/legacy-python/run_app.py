#!/usr/bin/env python3
"""
Run the Streamlit app
"""

import subprocess
import sys
import os

def main():
    # Check if streamlit is installed
    try:
        import streamlit
    except ImportError:
        print("Streamlit not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "streamlit"])
    
    # Check if config.env exists
    if not os.path.exists("config.env"):
        print("❌ config.env not found!")
        print("Please create config.env with your Google Cloud settings:")
        print("PROJECT_ID=your-project-id")
        print("LOCATION=us")
        print("PROCESSOR_ID=your-processor-id")
        print("GOOGLE_APPLICATION_CREDENTIALS=./credentials.json")
        return
    
    # Run streamlit app
    print("🚀 Starting Streamlit app...")
    print("Open your browser to: http://localhost:8501")
    subprocess.run([sys.executable, "-m", "streamlit", "run", "app.py"])

if __name__ == "__main__":
    main()
