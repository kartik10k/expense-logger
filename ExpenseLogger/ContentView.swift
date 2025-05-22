import SwiftUI
import Speech
import AVFoundation

struct Expense: Identifiable, Codable {
    let id = UUID()
    let date: Date
    let category: String
    let amount: Double
    let description: String
}

class ExpenseStore: ObservableObject {
    @Published var expenses: [Expense] = []
    private let saveKey = "SavedExpenses"
    
    init() {
        loadExpenses()
    }
    
    func addExpense(_ expense: Expense) {
        expenses.append(expense)
        saveExpenses()
    }
    
    func saveExpenses() {
        if let encoded = try? JSONEncoder().encode(expenses) {
            UserDefaults.standard.set(encoded, forKey: saveKey)
        }
    }
    
    func loadExpenses() {
        if let data = UserDefaults.standard.data(forKey: saveKey),
           let decoded = try? JSONDecoder().decode([Expense].self, from: data) {
            expenses = decoded
        }
    }
    
    func exportToCSV() -> String {
        var csvString = "Date,Category,Amount,Description\n"
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        
        for expense in expenses {
            let dateString = dateFormatter.string(from: expense.date)
            csvString.append("\(dateString),\(expense.category),\(expense.amount),\(expense.description)\n")
        }
        return csvString
    }
}

class SpeechRecognizer: ObservableObject {
    private let speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    
    @Published var isRecording = false
    @Published var transcribedText = ""
    
    func startRecording() throws {
        // Cancel any previous task
        recognitionTask?.cancel()
        recognitionTask = nil
        
        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        
        guard let recognitionRequest = recognitionRequest else { return }
        recognitionRequest.shouldReportPartialResults = true
        
        // Start recognition
        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }
            
            if let result = result {
                self.transcribedText = result.bestTranscription.formattedString
            }
            
            if error != nil {
                self.stopRecording()
            }
        }
        
        // Configure audio engine
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            self.recognitionRequest?.append(buffer)
        }
        
        audioEngine.prepare()
        try audioEngine.start()
        isRecording = true
    }
    
    func stopRecording() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        isRecording = false
    }
}

struct ContentView: View {
    @StateObject private var expenseStore = ExpenseStore()
    @StateObject private var speechRecognizer = SpeechRecognizer()
    @State private var showingExportSheet = false
    
    var body: some View {
        NavigationView {
            VStack {
                // Recording Button
                Button(action: {
                    if speechRecognizer.isRecording {
                        speechRecognizer.stopRecording()
                        processTranscription()
                    } else {
                        try? speechRecognizer.startRecording()
                    }
                }) {
                    Image(systemName: speechRecognizer.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                        .resizable()
                        .frame(width: 64, height: 64)
                        .foregroundColor(speechRecognizer.isRecording ? .red : .blue)
                }
                .padding()
                
                // Transcription Text
                Text(speechRecognizer.transcribedText)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                // Expenses List
                List(expenseStore.expenses) { expense in
                    VStack(alignment: .leading) {
                        Text("\(expense.amount) Rs - \(expense.category)")
                            .font(.headline)
                        Text(expense.description)
                            .font(.subheadline)
                            .foregroundColor(.gray)
                        Text(expense.date, style: .date)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Expense Logger")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: {
                        showingExportSheet = true
                    }) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
            .sheet(isPresented: $showingExportSheet) {
                ShareSheet(activityItems: [expenseStore.exportToCSV()])
            }
        }
    }
    
    private func processTranscription() {
        let text = speechRecognizer.transcribedText.lowercased()
        
        // Extract amount
        let amountPattern = #"(\d+(?:\.\d+)?)"#
        if let amountRange = text.range(of: amountPattern, options: .regularExpression),
           let amount = Double(text[amountRange]) {
            
            // Determine category
            var category = "Other"
            if text.contains("sabzi") || text.contains("vegetable") {
                category = "Vegetables"
            } else if text.contains("groceries") || text.contains("store") {
                category = "Groceries"
            }
            
            // Create and save expense
            let expense = Expense(
                date: Date(),
                category: category,
                amount: amount,
                description: speechRecognizer.transcribedText
            )
            
            expenseStore.addExpense(expense)
        }
        
        speechRecognizer.transcribedText = ""
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }
    
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
} 