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
        const selectAllCheckbox = document.getElementById('selectAll');
        const deleteSelectedButton = document.getElementById('deleteSelected');
        const addManualForm = document.getElementById('addManualForm');
        const prevMonthButton = document.getElementById('prevMonth');
        const nextMonthButton = document.getElementById('nextMonth');
        const refreshButton = document.getElementById('refreshButton');

        recordButton.addEventListener('click', () => this.toggleRecording());
        exportButton.addEventListener('click', () => this.exportSelected());
        editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));
        selectAllCheckbox.addEventListener('change', () => this.toggleSelectAll());
        deleteSelectedButton.addEventListener('click', () => this.deleteSelected());
        addManualForm.addEventListener('submit', (e) => this.handleManualAdd(e));
        prevMonthButton.addEventListener('click', () => this.navigateMonth(-1));
        nextMonthButton.addEventListener('click', () => this.navigateMonth(1));
        refreshButton.addEventListener('click', () => this.checkForUpdates());
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
                'samosa', 'kachori', 'pav', 'bread', 'roti', 'chapati', 'naan'
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

    getCurrentMonthExpenses() {
        const currentMonth = this.currentDate.getMonth();
        const currentYear = this.currentDate.getFullYear();
        return this.expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate.getMonth() === currentMonth && 
                   expenseDate.getFullYear() === currentYear;
        });
    }

    toggleSelectAll() {
        const selectAllCheckbox = document.getElementById('selectAll');
        const monthExpenses = this.getCurrentMonthExpenses();
        
        // Clear previous selections
        this.selectedExpenses.clear();
        
        if (selectAllCheckbox.checked) {
            // Add all current month expenses to selection
            monthExpenses.forEach(expense => {
                this.selectedExpenses.add(expense.id);
            });
        }
        
        this.renderExpenses();
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

    updateSelectAllCheckbox() {
        const selectAllCheckbox = document.getElementById('selectAll');
        const monthExpenses = this.getCurrentMonthExpenses();
        const monthExpenseIds = new Set(monthExpenses.map(expense => expense.id));
        
        // Check if all current month expenses are selected
        const allSelected = monthExpenses.length > 0 && 
            monthExpenses.every(expense => this.selectedExpenses.has(expense.id));
        
        selectAllCheckbox.checked = allSelected;
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

    deleteSelected() {
        const monthExpenses = this.getCurrentMonthExpenses();
        const selectedMonthExpenses = monthExpenses.filter(expense => 
            this.selectedExpenses.has(expense.id)
        );
        
        const count = selectedMonthExpenses.length;
        if (count === 0) return;

        const totalAmount = selectedMonthExpenses.reduce((sum, exp) => sum + exp.amount, 0);
        
        let message = `Are you sure you want to delete ${count} expense${count > 1 ? 's' : ''}?\n\n`;
        message += `Total Amount: ${totalAmount} Rs\n`;
        message += `Categories: ${[...new Set(selectedMonthExpenses.map(exp => exp.category))].join(', ')}\n\n`;
        message += 'This action cannot be undone.';

        if (confirm(message)) {
            // Remove only the selected expenses from the current month
            this.expenses = this.expenses.filter(expense => 
                !this.selectedExpenses.has(expense.id)
            );
            this.selectedExpenses.clear();
            this.saveExpenses();
            this.renderExpenses();
            this.updateDeleteButton();
            this.updateSelectAllCheckbox();
        }
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
    }

    navigateMonth(delta) {
        this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        this.selectedExpenses.clear(); // Clear selections when changing months
        this.updateMonthDisplay();
        this.renderExpenses();
        this.updateDeleteButton();
        this.updateSelectAllCheckbox();
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

    async checkForUpdates() {
        try {
            // Show loading state
            const refreshButton = document.getElementById('refreshButton');
            refreshButton.style.opacity = '0.5';
            refreshButton.style.pointerEvents = 'none';

            // Check for updates
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                // Initiate the service worker update, but don't await it to ensure quick UI refresh
                registration.update();
            }

            // Reload the page immediately to show the latest version (or attempt to get it)
            window.location.reload();
        } catch (error) {
            console.error('Error checking for updates:', error);
            alert('Error checking for updates. Please try again.');
            // Reset button state on error
            const refreshButton = document.getElementById('refreshButton');
            refreshButton.style.opacity = '1';
            refreshButton.style.pointerEvents = 'auto';
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
                
                // Optional: Check for updates when app starts, which triggers automatic reload via message listener
                // registration.active.postMessage('CHECK_UPDATE');
            })
            .catch(err => {
                console.log('ServiceWorker registration failed: ', err);
            });
    });
}

// Listen for update notifications from service worker (for automatic updates on activation)
navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data === 'UPDATE_AVAILABLE') {
        // Reload the page to get the new version
        window.location.reload();
    }
}); 