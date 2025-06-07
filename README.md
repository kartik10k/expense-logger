# Audio Expense Logger

This Python script listens to audio input and logs expenses in a CSV file. It uses speech recognition to convert spoken words into text and automatically categorizes expenses.

## Features

- Real-time speech recognition
- Automatic expense categorization
- CSV file logging with timestamps
- Support for common expense categories

## Setup

1. Install the required dependencies:
```bash
pip install -r requirements.txt
```

2. Make sure you have a working microphone connected to your computer.

## Usage

1. Run the script:
```bash
python expense_logger.py
```

2. Speak your expense in the format: "amount Rs for category"
   Example: "10 Rs for Sabzi"

3. The script will:
   - Convert your speech to text
   - Extract the amount and category
   - Log the expense in expenses.csv
   - Display a confirmation message

4. Press Ctrl+C to stop the program

## CSV Format

The expenses are logged in a CSV file with the following columns:
- Date: Timestamp of the entry
- Category: Expense category (e.g., Vegetables, Groceries, etc.)
- Amount: The expense amount in Rs
- Description: The original spoken text

## Supported Categories

- Vegetables (sabzi)
- Groceries
- Food
- Transport
- Rent
- Utilities
- Other (default category) 