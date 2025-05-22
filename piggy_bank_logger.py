import speech_recognition as sr
import pandas as pd
from datetime import datetime
import os
import time
from difflib import SequenceMatcher
import re

def create_expense_file():
    """Create a new CSV file if it doesn't exist"""
    if not os.path.exists('expenses.csv'):
        df = pd.DataFrame(columns=['Date', 'Category', 'Amount', 'Description'])
        df.to_csv('expenses.csv', index=False)
        print("Created new expenses.csv file")

def normalize_text(text):
    """Normalize text for better comparison"""
    # Convert to lowercase and remove special characters
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    return ' '.join(text.split())

def calculate_similarity(text1, text2):
    """Calculate similarity between two texts"""
    text1 = normalize_text(text1)
    text2 = normalize_text(text2)
    return SequenceMatcher(None, text1, text2).ratio()

def extract_amount(text):
    """Extract amount from text"""
    numbers = re.findall(r'\d+(?:\.\d+)?', text)
    if numbers:
        return float(numbers[0])
    return None

def check_duplicate(new_text, time_window_minutes=5):
    """Check for duplicate entries using similarity matching"""
    if not os.path.exists('expenses.csv'):
        return False, None
        
    df = pd.read_csv('expenses.csv')
    if df.empty:
        return False, None
        
    # Convert Date column to datetime
    df['Date'] = pd.to_datetime(df['Date'])
    
    # Get current time
    current_time = datetime.now()
    
    # Filter entries within time window
    recent_entries = df[df['Date'] >= current_time - pd.Timedelta(minutes=time_window_minutes)]
    
    # Calculate similarity scores for each recent entry
    similarities = []
    for _, entry in recent_entries.iterrows():
        similarity = calculate_similarity(new_text, entry['Description'])
        similarities.append((similarity, entry))
    
    # Sort by similarity score
    similarities.sort(reverse=True, key=lambda x: x[0])
    
    # Check if any entry has high similarity
    if similarities and similarities[0][0] > 0.7:  # 70% similarity threshold
        return True, similarities[0][1]
    
    return False, None

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
    print(f"Logged expense: {amount} Rs for {description}")

def display_potential_duplicate(entry):
    """Display potential duplicate entry details"""
    print("\nPotential duplicate entry found:")
    print(f"Time: {entry['Date']}")
    print(f"Amount: {entry['Amount']} Rs")
    print(f"Description: {entry['Description']}")
    print(f"Category: {entry['Category']}")

def wait_for_confirmation(timeout=10):
    """Wait for user confirmation with timeout"""
    print("Type 'y' within 10 seconds to confirm entry, or press Enter to cancel...")
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        if input().lower() == 'y':
            return True
        time.sleep(0.1)
    
    return False

def listen_for_expense():
    """Listen for expense input"""
    recognizer = sr.Recognizer()
    
    with sr.Microphone() as source:
        print("Listening...")
        audio = recognizer.listen(source)
        
        try:
            text = recognizer.recognize_google(audio)
            print(f"You said: {text}")
            
            amount = extract_amount(text)
            if amount:
                # Check for duplicate entry using similarity matching
                is_duplicate, duplicate_entry = check_duplicate(text)
                if is_duplicate:
                    print(f"Warning: Similar entry found!")
                    display_potential_duplicate(duplicate_entry)
                    print("Type 'y' to proceed anyway, or press Enter to cancel")
                    
                    if not wait_for_confirmation():
                        print("Entry cancelled due to possible duplicate")
                        return False
                
                # Extract category from text
                category = "Other"  # Default category
                if "sabzi" in text.lower() or "vegetable" in text.lower():
                    category = "Vegetables"
                elif "groceries" in text.lower() or "store" in text.lower():
                    category = "Groceries"
                # Add more category checks as needed
                
                # Log the expense
                log_expense(category, amount, text)
                return True
            else:
                print("Could not identify amount in the speech")
                return False
                
        except sr.UnknownValueError:
            print("Could not understand audio")
            return False
        except sr.RequestError as e:
            print(f"Could not request results; {e}")
            return False

def main():
    # Create expense file if it doesn't exist
    create_expense_file()
    
    print("Expense Logger Started!")
    print("Press Enter to start recording, or Ctrl+C to exit")
    
    try:
        while True:
            input("\nPress Enter to speak your expense...")
            
            # Listen for expense
            listen_for_expense()
            
            # Small delay to prevent multiple triggers
            time.sleep(0.5)
            
    except KeyboardInterrupt:
        print("\nExpense Logger Stopped!")

if __name__ == "__main__":
    main() 