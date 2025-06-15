if (typeof window.appConfig === 'undefined') {
    console.warn('window.appConfig is undefined. Providing a default configuration.');
    window.appConfig = {
        HUGGINGFACE: {
            API_KEY: '', // Empty key, so LLM won't work, but app won't crash
            MODEL: 'mistralai/Mistral-7B-Instruct-v0.2',
            MAX_RETRIES: 3,
            RATE_LIMIT_COOLDOWN: 60000,
        },
        APP: {
            VERSION: '1.0.0',
            CACHE_KEY: 'classificationCache',
        }
    };
}

class ExpenseLogger {
    constructor() {
        this.expenses = JSON.parse(localStorage.getItem('expenses')) || [];
        this.currentDate = new Date();
        this.recognition = null;
        this.isRecording = false;
        this.currentEditId = null;
        this.selectedExpenses = new Set();
        this.hf = null;
        this.classificationCache = new Map();
        this.rateLimitReset = 0;
        this.retryCount = 0;
        this.maxRetries = window.appConfig.HUGGINGFACE.MAX_RETRIES + 1;
        
        this.initializeSpeechRecognition();
        this.setupEventListeners();
        this.initializeHF();
        this.updateMonthDisplay();
        this.renderExpenses();
    }

    initializeSpeechRecognition() {
        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = false;
                this.recognition.interimResults = true;
                this.recognition.lang = 'en-US';

                this.recognition.onstart = () => {
                    this.isRecording = true;
                    this.updateRecordButton();
                    document.getElementById('transcription').textContent = 'Listening...';
                };

                this.recognition.onresult = (event) => {
                    const transcript = Array.from(event.results)
                        .map(result => result[0].transcript)
                        .join('');
                    
                    document.getElementById('transcription').textContent = transcript;
                    
                    // If this is the final result, process it
                    if (event.results[0].isFinal) {
                        this.processTranscription(transcript);
                    }
                };

                this.recognition.onend = () => {
                    this.isRecording = false;
                    this.updateRecordButton();
                    // Clear transcription after a short delay
                    setTimeout(() => {
                        document.getElementById('transcription').textContent = '';
                    }, 1000);
                };

                this.recognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                    this.isRecording = false;
                    this.updateRecordButton();
                    document.getElementById('transcription').textContent = '';
                };

                // Enable the record button
                const recordButton = document.getElementById('recordButton');
                if (recordButton) {
                    recordButton.disabled = false;
                }
            } else {
                console.warn('Speech recognition not supported');
                const recordButton = document.getElementById('recordButton');
                if (recordButton) {
                    recordButton.disabled = true;
                }
            }
        } catch (error) {
            console.error('Error initializing speech recognition:', error);
            const recordButton = document.getElementById('recordButton');
            if (recordButton) {
                recordButton.disabled = true;
            }
        }
    }

    setupEventListeners() {
        const recordButton = document.getElementById('recordButton');
        const exportButton = document.getElementById('exportSelected');
        const editForm = document.getElementById('editForm');
        const selectAllMonthCheckbox = document.getElementById('selectAllMonth');
        const selectAllYearCheckbox = document.getElementById('selectAllYear');
        const deleteSelectedButton = document.getElementById('deleteSelected');
        const addManualForm = document.getElementById('addManualForm');
        const prevMonthButton = document.getElementById('prevMonth');
        const nextMonthButton = document.getElementById('nextMonth');

        recordButton.addEventListener('click', () => this.toggleRecording());
        exportButton.addEventListener('click', () => this.exportSelected());
        editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));
        selectAllMonthCheckbox.addEventListener('change', () => this.toggleSelectAllMonth());
        selectAllYearCheckbox.addEventListener('change', () => this.toggleSelectAllYear());
        deleteSelectedButton.addEventListener('click', () => this.deleteSelected());
        addManualForm.addEventListener('submit', (e) => this.handleManualAdd(e));
        prevMonthButton.addEventListener('click', () => this.navigateMonth(-1));
        nextMonthButton.addEventListener('click', () => this.navigateMonth(1));
    }

    toggleRecording() {
        if (!this.recognition) {
            alert('Speech recognition is not supported in your browser.');
            return;
        }

        try {
            if (this.isRecording) {
                this.recognition.stop();
            } else {
                this.recognition.start();
            }
        } catch (error) {
            console.error('Error toggling recording:', error);
            this.isRecording = false;
            this.updateRecordButton();
        }
    }

    updateRecordButton() {
        const button = document.getElementById('recordButton');
        if (!button) return;

        if (this.isRecording) {
            button.classList.add('recording');
            button.querySelector('.mic-icon').textContent = '⏹';
        } else {
            button.classList.remove('recording');
            button.querySelector('.mic-icon').textContent = '🎤';
        }
    }

    async processTranscription(text) {
        // Extract amount
        const amountPattern = /(\d+(?:\.\d+)?)/;
        const amountMatch = text.match(amountPattern);
        
        if (amountMatch) {
            const amount = parseFloat(amountMatch[1]);
            
            // Category classification using semantic similarity
            const category = await this.classifyCategory(text);
            
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
    }

    async initializeHF() {
        try {
            // Initialize Hugging Face client with the configured token
            this.hf = new HfInference(window.appConfig.HUGGINGFACE.API_KEY);
            
            // Load cache from localStorage
            const savedCache = localStorage.getItem(window.appConfig.APP.CACHE_KEY);
            if (savedCache) {
                this.classificationCache = new Map(JSON.parse(savedCache));
            }
        } catch (error) {
            console.error('Error initializing Hugging Face:', error);
        }
    }

    saveCache() {
        // Save cache to localStorage
        const cacheArray = Array.from(this.classificationCache.entries());
        localStorage.setItem(window.appConfig.APP.CACHE_KEY, JSON.stringify(cacheArray));
    }

    async classifyCategory(text) {
        if (!this.hf) {
            return this.basicClassifyCategory(text);
        }

        // Check cache first
        const cacheKey = text.toLowerCase().trim();
        if (this.classificationCache.has(cacheKey)) {
            return this.classificationCache.get(cacheKey);
        }

        try {
            // Check rate limit
            if (Date.now() < this.rateLimitReset) {
                console.log('Rate limit hit, using fallback classification');
                return this.basicClassifyCategory(text);
            }

            // Prepare the enhanced prompt
            const prompt = this.generatePrompt(text);

            // Use the Mistral 7B model for classification
            const response = await this.hf.textGeneration({
                model: window.appConfig.HUGGINGFACE.MODEL,
                inputs: prompt,
                parameters: {
                    max_new_tokens: 10,
                    temperature: 0.1,
                    top_p: 0.95,
                    repetition_penalty: 1.1
                }
            });

            // Clean and normalize the response
            const category = this.normalizeCategory(response.generated_text.trim());
            
            // Cache the result
            this.classificationCache.set(cacheKey, category);
            this.saveCache();

            // Reset retry count on success
            this.retryCount = 0;

            return category;
        } catch (error) {
            console.error('Error in LLM classification:', error);
            
            // Handle rate limiting
            if (error.message.includes('rate limit')) {
                this.rateLimitReset = Date.now() + window.appConfig.HUGGINGFACE.RATE_LIMIT_COOLDOWN;
                this.retryCount++;
                
                if (this.retryCount < this.maxRetries) {
                    // Wait and retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return this.classifyCategory(text);
                }
            }
            
            return this.basicClassifyCategory(text);
        }
    }

    generatePrompt(text) {
        return `You are an expense categorization assistant. Your task is to classify the given expense description into one of these categories: Food, Transport, Utilities, Housing, or Other.

Consider these guidelines:
- Food: Any expense related to groceries, restaurants, snacks, beverages, or food items
- Transport: Any expense related to travel, vehicles, fuel, tickets, or transportation services
- Utilities: Any expense related to bills, services, subscriptions, or digital services
- Housing: Any expense related to rent, property, furniture, or home maintenance
- Other: Any expense that doesn't fit the above categories

Expense Description: "${text}"

Respond with ONLY the category name (Food, Transport, Utilities, Housing, or Other).`;
    }

    normalizeCategory(category) {
        const categoryMap = {
            'food': 'Food',
            'transport': 'Transport',
            'utilities': 'Utilities',
            'housing': 'Housing',
            'other': 'Other',
            // Handle common variations
            'food and beverages': 'Food',
            'transportation': 'Transport',
            'utility': 'Utilities',
            'home': 'Housing',
            'house': 'Housing',
            'accommodation': 'Housing',
            'travel': 'Transport',
            'commute': 'Transport',
            'bills': 'Utilities',
            'services': 'Utilities',
            'groceries': 'Food',
            'restaurant': 'Food',
            'dining': 'Food'
        };

        const normalized = category.toLowerCase().trim();
        return categoryMap[normalized] || 'Other';
    }

    basicClassifyCategory(text) {
        // Original basic classification logic as fallback
        const categoryEmbeddings = {
            'Housing': [
                'rent', 'house', 'apartment', 'home', 'mortgage', 'property', 'room',
                'accommodation', 'lease', 'flat', 'residence', 'dwelling', 'housing',
                'pg', 'hostel', 'stay', 'lodging', 'maintenance', 'repair', 'furniture'
            ],
            'Utilities': [
                'electricity', 'water', 'gas', 'internet', 'phone', 'bill', 'utility',
                'wifi', 'broadband', 'power', 'connection', 'service', 'utilities',
                'mobile', 'sim', 'recharge', 'data', 'plan', 'package', 'subscription'
            ],
            'Transport': [
                'bus', 'train', 'taxi', 'uber', 'fuel', 'petrol', 'diesel', 'transport',
                'travel', 'metro', 'auto', 'commute', 'journey', 'fare', 'ticket',
                'ola', 'rapido', 'bike', 'scooter', 'car', 'vehicle', 'maintenance'
            ],
            'Food': [
                'food', 'restaurant', 'cafe', 'meal', 'grocery', 'vegetable', 'fruit',
                'sabzi', 'store', 'market', 'dining', 'lunch', 'dinner', 'breakfast',
                'snack', 'drink', 'beverage', 'cooking', 'ingredients', 'spice', 'masala',
                'samosa', 'kachori', 'pav', 'bread', 'roti', 'chapati', 'naan',
                'ice cream', 'dessert', 'sweet', 'candy', 'chocolate', 'bakery', 'cake', 'pastry'
            ]
        };

        const scores = {};
        const words = text.toLowerCase().split(/[\s,]+/);
        const bigrams = this.generateBigrams(words);

        for (const [category, embeddings] of Object.entries(categoryEmbeddings)) {
            let score = 0;
            
            for (const word of words) {
                if (embeddings.includes(word)) {
                    score += 2;
                }
                
                for (const embedding of embeddings) {
                    if (word === embedding) {
                        score += 2;
                    }
                    else if (word.includes(embedding) || embedding.includes(word)) {
                        score += 1;
                    }
                    else if (this.levenshteinDistance(word, embedding) <= 2) {
                        score += 0.5;
                    }
                }
            }

            for (const bigram of bigrams) {
                if (embeddings.includes(bigram)) {
                    score += 3;
                }
            }
            
            scores[category] = score / (words.length + bigrams.length);
        }

        let maxScore = 0;
        let bestCategory = 'Other';

        for (const [category, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                bestCategory = category;
            }
        }

        return maxScore > 0.2 ? bestCategory : 'Other';
    }

    generateBigrams(words) {
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(words[i] + ' ' + words[i + 1]);
        }
        return bigrams;
    }

    levenshteinDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    addExpense(expense) {
        this.expenses.unshift(expense);
        this.saveExpenses();
        this.renderExpenses();
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
    }

    saveExpenses() {
        localStorage.setItem('expenses', JSON.stringify(this.expenses));
    }

    renderExpenses() {
        const expensesList = document.getElementById('expensesList');
        expensesList.innerHTML = '';

        const monthExpenses = this.getCurrentMonthExpenses();
        this.updateMonthDisplay();

        monthExpenses.forEach(expense => {
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
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
    }

    editExpense(id) {
        const expense = this.expenses.find(e => e.id === id);
        if (!expense) return;

        this.currentEditId = id;
        
        // Populate the edit form
        const date = new Date(expense.date);
        document.getElementById('editDate').value = date.toISOString().split('T')[0];
        document.getElementById('editAmount').value = expense.amount;
        document.getElementById('editCategory').value = expense.category;
        document.getElementById('editDescription').value = expense.description;
        
        // Show the modal
        document.getElementById('editModal').style.display = 'block';
    }

    handleEditSubmit(event) {
        event.preventDefault();
        
        const date = new Date(document.getElementById('editDate').value);
        const amount = parseFloat(document.getElementById('editAmount').value);
        const category = document.getElementById('editCategory').value;
        const description = document.getElementById('editDescription').value;
        
        // Update the expense
        const expenseIndex = this.expenses.findIndex(e => e.id === this.currentEditId);
        if (expenseIndex !== -1) {
            this.expenses[expenseIndex] = {
                ...this.expenses[expenseIndex],
                date,
                amount,
                category,
                description
            };
            
            this.saveExpenses();
            this.renderExpenses();
        }
        
        // Close the modal
        this.closeEditModal();
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
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
            this.updateSelectAllMonth();
            this.updateSelectAllYear();
        }
    }

    closeEditModal() {
        document.getElementById('editModal').style.display = 'none';
        this.currentEditId = null;
    }

    getCurrentMonthExpenses() {
        const currentMonth = this.currentDate.getMonth();
        const currentYear = this.currentDate.getFullYear();
        return this.expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate.getMonth() === currentMonth && 
                   expenseDate.getFullYear() === currentYear;
        });
    }

    toggleSelectAllMonth() {
        const selectAllMonthCheckbox = document.getElementById('selectAllMonth');
        const monthExpenses = this.getCurrentMonthExpenses();

        this.selectedExpenses.clear(); // Clear all selections first

        if (selectAllMonthCheckbox && selectAllMonthCheckbox.checked) {
            // Add all current month expenses to selection
            monthExpenses.forEach(expense => {
                this.selectedExpenses.add(expense.id);
            });
        }

        this.renderExpenses();
        this.updateDeleteButton();
        this.updateSelectAllYear(); // Also update year checkbox when month selection changes
    }

    toggleSelectAllYear() {
        const selectAllYearCheckbox = document.getElementById('selectAllYear');
        const yearExpenses = this.expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate.getFullYear() === this.currentDate.getFullYear();
        });

        this.selectedExpenses.clear(); // Clear all selections first

        if (selectAllYearCheckbox && selectAllYearCheckbox.checked) {
            // Add all expenses for the current year to selection
            yearExpenses.forEach(expense => {
                this.selectedExpenses.add(expense.id);
            });
        }

        this.renderExpenses();
        this.updateDeleteButton();
        this.updateSelectAllMonth(); // Also update month checkbox when year selection changes
    }

    toggleExpenseSelection(expenseId) {
        if (this.selectedExpenses.has(expenseId)) {
            this.selectedExpenses.delete(expenseId);
        } else {
            this.selectedExpenses.add(expenseId);
        }
        
        this.updateDeleteButton();
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
    }

    updateDeleteButton() {
        const deleteSelectedButton = document.getElementById('deleteSelected');
        const exportSelectedButton = document.getElementById('exportSelected');
        const hasSelection = this.selectedExpenses.size > 0;
        
        deleteSelectedButton.disabled = !hasSelection;
        exportSelectedButton.disabled = !hasSelection;
    }

    exportSelected() {
        const monthExpenses = this.getCurrentMonthExpenses();
        const selectedExpenses = monthExpenses.filter(expense => 
            this.selectedExpenses.has(expense.id)
        );
        
        if (selectedExpenses.length === 0) return;

        const headers = ['Date', 'Category', 'Amount', 'Description'];
        const rows = selectedExpenses.map(expense => [
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
        
        const monthYear = this.currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        link.setAttribute('href', url);
        link.setAttribute('download', `expenses_${monthYear}.csv`);
        link.style.visibility = 'hidden';
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    showAddManualForm() {
        document.getElementById('addManualModal').style.display = 'block';
    }

    closeAddManualModal() {
        document.getElementById('addManualModal').style.display = 'none';
        document.getElementById('addManualForm').reset();
    }

    handleManualAdd(event) {
        event.preventDefault();
        
        const date = new Date(document.getElementById('manualDate').value);
        const amount = parseFloat(document.getElementById('manualAmount').value);
        const category = document.getElementById('manualCategory').value;
        const description = document.getElementById('manualDescription').value;
        
        const expense = {
            id: Date.now(),
            date,
            category,
            amount,
            description
        };
        
        this.addExpense(expense);
        this.closeAddManualModal();
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
    }

    navigateMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.selectedExpenses.clear(); // Clear selections when changing months
        this.updateMonthDisplay();
        this.renderExpenses();
        this.updateDeleteButton();
        this.updateSelectAllMonth();
        this.updateSelectAllYear();
    }

    updateMonthDisplay() {
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];
        const monthDisplay = document.getElementById('currentMonth');
        if (monthDisplay) {
            monthDisplay.textContent = `${monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;
        }

        // Update total for current month
        const currentMonth = this.currentDate.getMonth();
        const currentYear = this.currentDate.getFullYear();
        const monthTotal = this.expenses
            .filter(expense => {
                const expenseDate = new Date(expense.date);
                return expenseDate.getMonth() === currentMonth && 
                       expenseDate.getFullYear() === currentYear;
            })
            .reduce((sum, expense) => sum + expense.amount, 0);

        const totalDisplay = document.getElementById('monthTotal');
        if (totalDisplay) {
            totalDisplay.textContent = `${monthTotal.toFixed(2)}`;
        }
    }

    updateSelectAllMonth() {
        const selectAllMonthCheckbox = document.getElementById('selectAllMonth');
        const monthExpenses = this.getCurrentMonthExpenses();
        
        // Check if all current month expenses are selected
        const allSelected = monthExpenses.length > 0 && 
            monthExpenses.every(expense => this.selectedExpenses.has(expense.id));
        
        if(selectAllMonthCheckbox) { // Check if element exists before setting property
            selectAllMonthCheckbox.checked = allSelected;
        }
    }

    updateSelectAllYear() {
        const selectAllYearCheckbox = document.getElementById('selectAllYear');
        const yearExpenses = this.expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate.getFullYear() === this.currentDate.getFullYear();
        });

        // Check if all current year expenses are selected
        const allSelectedYear = yearExpenses.length > 0 &&
                                 yearExpenses.every(expense => this.selectedExpenses.has(expense.id));
        
        if(selectAllYearCheckbox) { // Check if element exists before setting property
            selectAllYearCheckbox.checked = allSelectedYear;
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
        navigator.serviceWorker.register(`sw.js`)
            .then(reg => {
                console.log('ServiceWorker registration successful with scope: ', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed') {
                                if (navigator.serviceWorker.controller) {
                                    console.log('New service worker installed, notifying to skip waiting.');
                                    newWorker.postMessage({ type: 'SKIP_WAITING' });
                                } else {
                                    console.log('No existing service worker controller, new one will activate directly.');
                                }
                            }
                        });
                    }
                });

                // Listen for the controllerchange event to reload the page when a new SW takes control
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log('New service worker activated, reloading page due to controllerchange.');
                    window.location.reload();
                });
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
} 