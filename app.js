class ExpenseLogger {
    constructor() {
        this.expenses = JSON.parse(localStorage.getItem('expenses')) || [];
        this.recognition = null;
        this.isRecording = false;
        this.currentEditId = null;
        
        this.initializeSpeechRecognition();
        this.setupEventListeners();
        this.renderExpenses();
    }

    initializeSpeechRecognition() {
        if ('webkitSpeechRecognition' in window) {
            this.recognition = new webkitSpeechRecognition();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

            this.recognition.onresult = (event) => {
                const transcript = Array.from(event.results)
                    .map(result => result[0].transcript)
                    .join('');
                
                document.getElementById('transcription').textContent = transcript;
            };

            this.recognition.onend = () => {
                this.isRecording = false;
                this.updateRecordButton();
                this.processTranscription();
            };
        } else {
            alert('Speech recognition is not supported in your browser.');
        }
    }

    setupEventListeners() {
        const recordButton = document.getElementById('recordButton');
        const exportButton = document.getElementById('exportButton');
        const editForm = document.getElementById('editForm');

        recordButton.addEventListener('click', () => this.toggleRecording());
        exportButton.addEventListener('click', () => this.exportToCSV());
        editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));
    }

    toggleRecording() {
        if (!this.recognition) return;

        if (this.isRecording) {
            this.recognition.stop();
        } else {
            this.recognition.start();
            this.isRecording = true;
            this.updateRecordButton();
        }
    }

    updateRecordButton() {
        const button = document.getElementById('recordButton');
        if (this.isRecording) {
            button.classList.add('recording');
            button.querySelector('.mic-icon').textContent = '⏹';
        } else {
            button.classList.remove('recording');
            button.querySelector('.mic-icon').textContent = '🎤';
        }
    }

    processTranscription() {
        const text = document.getElementById('transcription').textContent.toLowerCase();
        
        // Extract amount
        const amountPattern = /(\d+(?:\.\d+)?)/;
        const amountMatch = text.match(amountPattern);
        
        if (amountMatch) {
            const amount = parseFloat(amountMatch[1]);
            
            // Determine category
            let category = 'Other';
            if (text.includes('sabzi') || text.includes('vegetable')) {
                category = 'Vegetables';
            } else if (text.includes('groceries') || text.includes('store')) {
                category = 'Groceries';
            }
            
            // Create expense
            const expense = {
                id: Date.now(),
                date: new Date(),
                category,
                amount,
                description: text
            };
            
            this.addExpense(expense);
        }
        
        document.getElementById('transcription').textContent = '';
    }

    addExpense(expense) {
        this.expenses.unshift(expense);
        this.saveExpenses();
        this.renderExpenses();
    }

    saveExpenses() {
        localStorage.setItem('expenses', JSON.stringify(this.expenses));
    }

    renderExpenses() {
        const expensesList = document.getElementById('expensesList');
        expensesList.innerHTML = '';

        this.expenses.forEach(expense => {
            const expenseElement = document.createElement('div');
            expenseElement.className = 'expense-item';
            
            const date = new Date(expense.date).toLocaleDateString();
            
            expenseElement.innerHTML = `
                <div class="expense-amount">${expense.amount} Rs</div>
                <div class="expense-category">${expense.category}</div>
                <div class="expense-description">${expense.description}</div>
                <div class="expense-date">${date}</div>
                <div class="expense-actions">
                    <button class="action-button edit-button" onclick="expenseLogger.editExpense(${expense.id})">✏️</button>
                    <button class="action-button delete-button" onclick="expenseLogger.deleteExpense(${expense.id})">🗑️</button>
                </div>
            `;
            
            expensesList.appendChild(expenseElement);
        });
    }

    editExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        this.currentEditId = id;
        
        // Populate the edit form
        document.getElementById('editAmount').value = expense.amount;
        document.getElementById('editCategory').value = expense.category;
        document.getElementById('editDescription').value = expense.description;
        
        // Show the modal
        document.getElementById('editModal').style.display = 'block';
    }

    handleEditSubmit(event) {
        event.preventDefault();
        
        const amount = parseFloat(document.getElementById('editAmount').value);
        const category = document.getElementById('editCategory').value;
        const description = document.getElementById('editDescription').value;
        
        // Update the expense
        const expenseIndex = this.expenses.findIndex(e => e.id === this.currentEditId);
        if (expenseIndex !== -1) {
            this.expenses[expenseIndex] = {
                ...this.expenses[expenseIndex],
                amount,
                category,
                description
            };
            
            this.saveExpenses();
            this.renderExpenses();
        }
        
        // Close the modal
        this.closeEditModal();
    }

    deleteExpense(id) {
        if (confirm('Are you sure you want to delete this expense?')) {
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.saveExpenses();
            this.renderExpenses();
        }
    }

    closeEditModal() {
        document.getElementById('editModal').style.display = 'none';
        this.currentEditId = null;
    }

    exportToCSV() {
        const headers = ['Date', 'Category', 'Amount', 'Description'];
        const rows = this.expenses.map(expense => [
            new Date(expense.date).toISOString(),
            expense.category,
            expense.amount,
            expense.description
        ]);
        
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', `expenses_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Initialize the app
let expenseLogger;
document.addEventListener('DOMContentLoaded', () => {
    expenseLogger = new ExpenseLogger();
});

// Make closeEditModal available globally
function closeEditModal() {
    expenseLogger.closeEditModal();
}

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registration successful');
                
                // Check for updates when the app starts
                registration.active.postMessage('CHECK_UPDATE');
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// Listen for update notifications
navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data === 'UPDATE_AVAILABLE') {
        // Reload the page to get the new version
        window.location.reload();
    }
}); 