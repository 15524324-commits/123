import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  Upload, 
  History, 
  Printer, 
  Plus, 
  Save, 
  RefreshCw, 
  Trash2, 
  ChevronRight, 
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, googleProvider, signInWithPopup } from './firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  deleteDoc, 
  doc, 
  Timestamp 
} from 'firebase/firestore';
import { performOCR, generateVariations, QuestionVariation } from './services/geminiService';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// --- Types ---
interface WrongQuestionRecord {
  id: string;
  userId: string;
  originalText: string;
  knowledgePoint: string;
  variations: QuestionVariation[];
  createdAt: any;
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setErrorInfo(event.error?.message || 'Unknown error');
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center bg-red-50">
        <AlertCircle className="w-16 h-16 mb-4 text-red-500" />
        <h1 className="text-2xl font-bold text-red-800">出错了</h1>
        <p className="mt-2 text-red-600">{errorInfo}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 mt-6 text-white bg-red-600 rounded-full hover:bg-red-700 transition-colors"
        >
          刷新页面
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'identify' | 'notebook'>('identify');
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<{ text: string; knowledgePoint: string } | null>(null);
  const [variations, setVariations] = useState<QuestionVariation[]>([]);
  const [records, setRecords] = useState<WrongQuestionRecord[]>([]);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printRef = useRef<HTMLDivElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Records Listener
  useEffect(() => {
    if (!user) {
      setRecords([]);
      return;
    }

    const q = query(
      collection(db, 'questions'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as WrongQuestionRecord[];
      setRecords(docs);
    }, (error) => {
      console.error("Firestore Error:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await performOCR(base64);
        setOcrResult(result);
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("OCR failed:", error);
      setLoading(false);
    }
  };

  const handleGenerateVariations = async () => {
    if (!ocrResult) return;
    setLoading(true);
    try {
      const result = await generateVariations(ocrResult.text, ocrResult.knowledgePoint);
      setVariations(result);
    } catch (error) {
      console.error("Generation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToNotebook = async () => {
    if (!user || !ocrResult || variations.length === 0) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'questions'), {
        userId: user.uid,
        originalText: ocrResult.text,
        knowledgePoint: ocrResult.knowledgePoint,
        variations: variations,
        createdAt: Timestamp.now()
      });
      setOcrResult(null);
      setVariations([]);
      setActiveTab('notebook');
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'questions', id));
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const toggleSelectRecord = (id: string) => {
    setSelectedRecords(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handlePrint = async () => {
    if (selectedRecords.length === 0) return;
    setLoading(true);
    
    const printElement = document.getElementById('print-area');
    if (!printElement) return;

    try {
      const canvas = await html2canvas(printElement, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save('错题集.pdf');
    } catch (error) {
      console.error("Print failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-slate-100">
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Printer className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">错题举一反三打印机</h1>
          <p className="text-slate-500 mb-8">拍照识别错题，AI 生成相似题目及易错点解析，支持错题本管理与 PDF 打印。</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
          >
            使用 Google 账号登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 pb-24 font-sans text-slate-900">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">错题打印机</span>
          </div>
          <div className="flex items-center gap-3">
            <img src={user.photoURL || ''} alt="avatar" className="w-8 h-8 rounded-full border border-slate-200" />
            <button onClick={handleLogout} className="text-xs text-slate-500 hover:text-red-500 transition-colors">退出</button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto p-4">
          {activeTab === 'identify' ? (
            <div className="space-y-6">
              {/* Upload Section */}
              {!ocrResult && !loading && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center flex flex-col items-center gap-4 hover:border-blue-400 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center">
                    <Camera className="w-8 h-8 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">上传错题图片</h3>
                    <p className="text-slate-500 text-sm">支持拍照或从相册选择</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/*" 
                    onChange={handleFileUpload}
                  />
                </motion.div>
              )}

              {loading && (
                <div className="bg-white rounded-3xl p-12 text-center flex flex-col items-center gap-4 shadow-sm">
                  <Loader2 className="w-12 h-12 animate-spin text-blue-600" />
                  <p className="text-slate-600 font-medium">AI 正在处理中，请稍候...</p>
                </div>
              )}

              {/* OCR Result & Generation */}
              {ocrResult && !loading && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-6"
                >
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <FileText className="w-4 h-4" /> 识别结果
                      </h3>
                      <button 
                        onClick={() => setOcrResult(null)}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <textarea 
                      value={ocrResult.text}
                      onChange={(e) => setOcrResult({ ...ocrResult, text: e.target.value })}
                      className="w-full min-h-[120px] p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-blue-500 text-sm leading-relaxed"
                    />
                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">知识点：</span>
                      <input 
                        value={ocrResult.knowledgePoint}
                        onChange={(e) => setOcrResult({ ...ocrResult, knowledgePoint: e.target.value })}
                        className="flex-1 bg-transparent border-b border-slate-200 focus:border-blue-500 outline-none text-sm py-1"
                      />
                    </div>
                    
                    {variations.length === 0 && (
                      <button 
                        onClick={handleGenerateVariations}
                        className="w-full mt-6 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                      >
                        <RefreshCw className="w-5 h-5" /> 生成举一反三题目
                      </button>
                    )}
                  </div>

                  {/* Variations Display */}
                  {variations.length > 0 && (
                    <div className="space-y-4">
                      <h3 className="font-bold text-slate-700 px-2">举一反三题目</h3>
                      {variations.map((v, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.1 }}
                          className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100"
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
                              {i + 1}
                            </span>
                            <span className="font-bold text-slate-700">变式题</span>
                          </div>
                          <div className="prose prose-sm max-w-none text-slate-700 mb-4">
                            <ReactMarkdown>{v.question}</ReactMarkdown>
                          </div>
                          <div className="bg-green-50 rounded-2xl p-4 mb-3">
                            <p className="text-xs font-bold text-green-700 mb-1 uppercase tracking-wider">正确答案</p>
                            <p className="text-sm text-green-800">{v.answer}</p>
                          </div>
                          <div className="bg-amber-50 rounded-2xl p-4">
                            <p className="text-xs font-bold text-amber-700 mb-1 uppercase tracking-wider">易错点分析</p>
                            <p className="text-sm text-amber-800 italic leading-relaxed">{v.analysis}</p>
                          </div>
                        </motion.div>
                      ))}
                      
                      <div className="flex gap-3 pt-4">
                        <button 
                          onClick={handleGenerateVariations}
                          className="flex-1 py-4 bg-slate-200 text-slate-700 rounded-2xl font-bold hover:bg-slate-300 transition-all flex items-center justify-center gap-2"
                        >
                          <RefreshCw className="w-5 h-5" /> 重新生成
                        </button>
                        <button 
                          onClick={handleSaveToNotebook}
                          className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                        >
                          <Save className="w-5 h-5" /> 保存到错题本
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Notebook Header */}
              <div className="flex items-center justify-between px-2 mb-2">
                <h2 className="text-xl font-bold">我的错题本 ({records.length})</h2>
                {records.length > 0 && (
                  <button 
                    onClick={handlePrint}
                    disabled={selectedRecords.length === 0}
                    className={cn(
                      "px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 transition-all",
                      selectedRecords.length > 0 
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-100" 
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    <Printer className="w-4 h-4" /> 打印所选 ({selectedRecords.length})
                  </button>
                )}
              </div>

              {records.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center flex flex-col items-center gap-4 border border-slate-100">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                    <History className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-400">还没有保存任何错题记录</p>
                  <button 
                    onClick={() => setActiveTab('identify')}
                    className="text-blue-600 font-bold hover:underline"
                  >
                    去识别错题
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {records.map((record) => (
                    <div 
                      key={record.id}
                      className={cn(
                        "bg-white rounded-2xl p-4 shadow-sm border transition-all flex items-start gap-4",
                        selectedRecords.includes(record.id) ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-100"
                      )}
                    >
                      <button 
                        onClick={() => toggleSelectRecord(record.id)}
                        className={cn(
                          "mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors",
                          selectedRecords.includes(record.id) ? "bg-blue-600 border-blue-600" : "border-slate-200"
                        )}
                      >
                        {selectedRecords.includes(record.id) && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {record.createdAt?.toDate().toLocaleDateString()}
                          </span>
                          <button 
                            onClick={() => handleDeleteRecord(record.id)}
                            className="text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <h4 className="font-bold text-slate-800 truncate mb-1">{record.knowledgePoint || '未分类'}</h4>
                        <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed">{record.originalText}</p>
                        <div className="mt-3 flex items-center gap-2">
                          <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                            {record.variations.length} 道变式题
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>

        {/* Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-slate-200 px-6 py-3 flex items-center justify-around z-20">
          <button 
            onClick={() => setActiveTab('identify')}
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              activeTab === 'identify' ? "text-blue-600" : "text-slate-400"
            )}
          >
            <Camera className="w-6 h-6" />
            <span className="text-[10px] font-bold">错题识别</span>
          </button>
          <button 
            onClick={() => setActiveTab('notebook')}
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              activeTab === 'notebook' ? "text-blue-600" : "text-slate-400"
            )}
          >
            <History className="w-6 h-6" />
            <span className="text-[10px] font-bold">错题本</span>
          </button>
        </nav>

        {/* Hidden Print Area */}
        <div className="fixed -left-[9999px] top-0">
          <div id="print-area" className="w-[210mm] p-[20mm] bg-white text-black font-serif">
            <h1 className="text-3xl font-bold text-center mb-10 border-b-2 border-black pb-4">错题举一反三集</h1>
            {records.filter(r => selectedRecords.includes(r.id)).map((record, idx) => (
              <div key={record.id} className="mb-12 break-inside-avoid">
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-xl font-bold">第 {idx + 1} 组</span>
                  <span className="text-sm bg-gray-100 px-3 py-1 rounded-full">知识点：{record.knowledgePoint}</span>
                </div>
                
                <div className="mb-6">
                  <h3 className="font-bold text-lg mb-2 underline">【原错题】</h3>
                  <div className="pl-4 border-l-4 border-gray-200 italic text-gray-700">
                    <ReactMarkdown>{record.originalText}</ReactMarkdown>
                  </div>
                </div>

                <div className="space-y-8">
                  {record.variations.map((v, vIdx) => (
                    <div key={vIdx} className="pl-4">
                      <h4 className="font-bold mb-2">【举一反三 {vIdx + 1}】</h4>
                      <div className="mb-4 leading-relaxed">
                        <ReactMarkdown>{v.question}</ReactMarkdown>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-4 rounded-lg">
                        <div>
                          <p className="font-bold mb-1">【正确答案】</p>
                          <p>{v.answer}</p>
                        </div>
                        <div>
                          <p className="font-bold mb-1">【易错点解析】</p>
                          <p className="italic">{v.analysis}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {idx < selectedRecords.length - 1 && <div className="mt-12 border-t border-dashed border-gray-300 w-full"></div>}
              </div>
            ))}
            <footer className="mt-20 text-center text-xs text-gray-400 border-t pt-4">
              生成于：{new Date().toLocaleString()} | 错题举一反三打印机
            </footer>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
