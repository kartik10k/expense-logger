import speech_recognition as sr
import pandas as pd
from datetime import datetime
import os

def create_expense_file():
    """Create a new CSV file if it doesn't exist"""
    if not os.path.exists('expenses.csv'):
        df = pd.DataFrame(columns=['Date', 'Category', 'Amount', 'Description'])
        df.to_csv('expenses.csv', index=False)
        print("Created new expenses.csv file")

def extract_amount(text):
    """Extract amount from text"""
    words = text.split()
    for word in words:
        if word.replace('.', '').isdigit():
            return float(word)
    return None

def extract_category(text):
    """Extract category from text"""
    # Common expense categories
    categories = {
        'sabzi': 'Vegetables',
        'vegetables': 'Vegetables',
        'groceries': 'Groceries',
        'food': 'Food',
        'transport': 'Transport',
        'rent': 'Rent',
        'utilities': 'Utilities'
    }
    
    text_lower = text.lower()
    for key, value in categories.items():
        if key in text_lower:
            return value
    return 'Other'

def log_expense(category, amount, description):
    """Log expense to CSV file"""
    df = pd.read_csv('expenses.csv')
    new_row = {
        'Date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'Category': category,
        'Amount': amount,
        'Description': description
    }
    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
    df.to_csv('expenses.csv', index=False)
    print(f"Logged expense: {amount} Rs for {category}")

def main():
    # Initialize recognizer
    recognizer = sr.Recognizer()
    
    # Create expense file if it doesn't exist
    create_expense_file()
    
    print("Expense Logger Started!")
    print("Speak your expense (e.g., '10 Rs for Sabzi')")
    print("Press Ctrl+C to exit")
    
    try:
        while True:
            with sr.Microphone() as source:
                print("\nListening...")
                audio = recognizer.listen(source)
                
                try:
                    # Convert speech to text
                    text = recognizer.recognize_google(audio)
                    print(f"You said: {text}")
                    
                    # Extract amount and category
                    amount = extract_amount(text)
                    if amount:
                        category = extract_category(text)
                        log_expense(category, amount, text)
                    else:
                        print("Could not identify amount in the speech")
                        
                except sr.UnknownValueError:
                    print("Could not understand audio")
                except sr.RequestError as e:
                    print(f"Could not request results; {e}")
                    
    except KeyboardInterrupt:
        print("\nExpense Logger Stopped!")

if __name__ == "__main__":
    main() 