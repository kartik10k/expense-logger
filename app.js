class ExpenseLogger {
    constructor() {
        this.expenses = JSON.parse(localStorage.getItem('expenses')) || [];
        this.recognition = null;
        this.isRecording = false;
        this.currentEditId = null;
        this.selectedExpenses = new Set();
        
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
        const selectAllCheckbox = document.getElementById('selectAll');
        const deleteSelectedButton = document.getElementById('deleteSelected');

        recordButton.addEventListener('click', () => this.toggleRecording());
        exportButton.addEventListener('click', () => this.exportToCSV());
        editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));
        selectAllCheckbox.addEventListener('change', () => this.toggleSelectAll());
        deleteSelectedButton.addEventListener('click', () => this.deleteSelected());
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
            
            // Category classification using semantic similarity
            const category = this.classifyCategory(text);
            
            // Keep the full transcription as description
            const description = text;
            
            // Create expense
            const expense = {
                id: Date.now(),
                date: new Date(),
                category,
                amount,
                description
            };
            
            this.addExpense(expense);
        }
        
        document.getElementById('transcription').textContent = '';
    }

    classifyCategory(text) {
        // Define category embeddings (representative words for each category)
        const categoryEmbeddings = {
            'Housing': [
                'rent', 'house', 'apartment', 'home', 'mortgage', 'property', 'room',
                'accommodation', 'lease', 'flat', 'residence', 'dwelling', 'housing'
            ],
            'Utilities': [
                'electricity', 'water', 'gas', 'internet', 'phone', 'bill', 'utility',
                'wifi', 'broadband', 'power', 'connection', 'service', 'utilities'
            ],
            'Transport': [
                'bus', 'train', 'taxi', 'uber', 'fuel', 'petrol', 'diesel', 'transport',
                'travel', 'metro', 'auto', 'commute', 'journey', 'fare', 'ticket'
            ],
            'Food': [
                'food', 'restaurant', 'cafe', 'meal', 'grocery', 'vegetable', 'fruit',
                'sabzi', 'store', 'market', 'dining', 'lunch', 'dinner', 'breakfast',
                'snack', 'drink', 'beverage', 'cooking', 'ingredients'
            ]
        };

        // Calculate similarity scores for each category
        const scores = {};
        const words = text.split(/\s+/);

        for (const [category, embeddings] of Object.entries(categoryEmbeddings)) {
            let score = 0;
            
            // Calculate word overlap and semantic similarity
            for (const word of words) {
                // Direct word match
                if (embeddings.includes(word)) {
                    score += 2;
                }
                
                // Check for word similarity (e.g., 'hous' matches 'house')
                for (const embedding of embeddings) {
                    if (word.includes(embedding) || embedding.includes(word)) {
                        score += 1;
                    }
                }
            }
            
            // Normalize score by text length
            scores[category] = score / words.length;
        }

        // Find category with highest score
        let maxScore = 0;
        let bestCategory = 'Other';

        for (const [category, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                bestCategory = category;
            }
        }

        // Only return a category if the confidence is high enough
        return maxScore > 0.3 ? bestCategory : 'Other';
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
                <div class="expense-checkbox">
                    <input type="checkbox" 
                           data-expense-id="${expense.id}"
                           ${this.selectedExpenses.has(expense.id) ? 'checked' : ''}
                           onchange="expenseLogger.toggleExpenseSelection(${expense.id})">
                </div>
                <div class="expense-content">
                    <div class="expense-amount">${expense.amount} Rs</div>
                    <div class="expense-category">${expense.category}</div>
                    <div class="expense-description">${expense.description}</div>
                    <div class="expense-date">${date}</div>
                </div>
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
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        const message = `Are you sure you want to delete this expense?\nAmount: ${expense.amount} Rs\nCategory: ${expense.category}\nDescription: ${expense.description}`;
        
        if (confirm(message)) {
            this.expenses = this.expenses.filter(e => e.id !== id);
            this.selectedExpenses.delete(id);
            this.saveExpenses();
            this.renderExpenses();
            this.updateDeleteButton();
            this.updateSelectAllCheckbox();
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

    toggleSelectAll() {
        const selectAllCheckbox = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.expense-checkbox input');
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
            const expenseId = parseInt(checkbox.dataset.expenseId);
            if (selectAllCheckbox.checked) {
                this.selectedExpenses.add(expenseId);
            } else {
                this.selectedExpenses.delete(expenseId);
            }
        });
        
        this.updateDeleteButton();
    }

    toggleExpenseSelection(expenseId) {
        if (this.selectedExpenses.has(expenseId)) {
            this.selectedExpenses.delete(expenseId);
        } else {
            this.selectedExpenses.add(expenseId);
        }
        
        this.updateDeleteButton();
        this.updateSelectAllCheckbox();
    }

    updateDeleteButton() {
        const deleteSelectedButton = document.getElementById('deleteSelected');
        deleteSelectedButton.disabled = this.selectedExpenses.size === 0;
    }

    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('selectAll');
        const checkboxes = document.querySelectorAll('.expense-checkbox input');
        selectAllCheckbox.checked = checkboxes.length > 0 && 
            Array.from(checkboxes).every(checkbox => checkbox.checked);
    }

    deleteSelected() {
        const count = this.selectedExpenses.size;
        if (count === 0) return;

        // Get details of selected expenses
        const selectedExpenses = this.expenses.filter(expense => this.selectedExpenses.has(expense.id));
        const totalAmount = selectedExpenses.reduce((sum, exp) => sum + exp.amount, 0);
        
        let message = `Are you sure you want to delete ${count} expense${count > 1 ? 's' : ''}?\n\n`;
        message += `Total Amount: ${totalAmount} Rs\n`;
        message += `Categories: ${[...new Set(selectedExpenses.map(exp => exp.category))].join(', ')}\n\n`;
        message += 'This action cannot be undone.';

        if (confirm(message)) {
            this.expenses = this.expenses.filter(expense => !this.selectedExpenses.has(expense.id));
            this.selectedExpenses.clear();
            this.saveExpenses();
            this.renderExpenses();
            this.updateDeleteButton();
            this.updateSelectAllCheckbox();
        }
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
                
                // Check for updates when app starts
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