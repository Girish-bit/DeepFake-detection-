/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { 
  Shield, 
  Upload, 
  AlertTriangle, 
  CheckCircle, 
  FileVideo, 
  Image as ImageIcon,
  Camera,
  Loader2,
  Info,
  Zap,
  Activity,
  Maximize2,
  RefreshCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Type } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DetectionResult {
  verdict: 'REAL' | 'FAKE';
  confidence: number;
  suspiciousRegions: string[];
  explanation: string;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const analysisTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle live video stream attachment
  React.useEffect(() => {
    if (isLiveMode && videoStream && liveVideoRef.current) {
      liveVideoRef.current.srcObject = videoStream;
      liveVideoRef.current.play().catch(err => console.error("Video play error:", err));
    }
  }, [isLiveMode, videoStream]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setResult(null);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpeg', '.jpg'],
      'image/png': ['.png'],
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'video/x-msvideo': ['.avi']
    },
    multiple: false
  } as any);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const extractFrame = (video: HTMLVideoElement): string => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  };

  const performAnalysis = async (base64Data: string, mimeType: string, isLive: boolean = false) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === 'undefined' || apiKey === '') {
        throw new Error("API_KEY_MISSING: Gemini API Key is not configured. Please add 'GOOGLE_API_KEY' to the Secrets panel in AI Studio.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      let parts: any[] = [
        { inlineData: { data: base64Data, mimeType } },
        { text: `
          Analyze this ${isLive ? 'live camera frame' : 'media'} for signs of deepfake manipulation. 
          Look for:
          1. Inconsistencies in lighting and shadows.
          2. Blurred edges around the face or hair.
          3. Unnatural skin textures or "glitches".
          4. Mismatched eye reflections or iris details.
          5. Artifacts around the mouth or teeth.

          Provide a verdict (REAL or FAKE), a confidence score (0-100), and a list of specific regions that look suspicious.
        `}
      ];

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: { parts },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verdict: { type: Type.STRING, description: "REAL or FAKE" },
              confidence: { type: Type.NUMBER, description: "Confidence percentage 0-100" },
              suspiciousRegions: { 
                type: Type.ARRAY, 
                items: { type: Type.STRING },
                description: "List of suspicious facial regions"
              },
              explanation: { type: Type.STRING, description: "Brief explanation of the verdict" }
            },
            required: ["verdict", "confidence", "suspiciousRegions", "explanation"]
          }
        }
      });

      let text = response.text || "";
      if (text.startsWith("```json")) {
        text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "");
      } else if (text.startsWith("```")) {
        text = text.replace(/^```\n?/, "").replace(/\n?```$/, "");
      }

      return JSON.parse(text.trim());
    } catch (err: any) {
      throw err;
    }
  };

  const handleDetect = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const isVideo = file.type.startsWith('video/');
      let base64Data = '';
      let mimeType = '';

      if (isVideo && videoRef.current) {
        base64Data = extractFrame(videoRef.current);
        mimeType = 'image/jpeg';
      } else {
        base64Data = await fileToBase64(file);
        mimeType = file.type;
      }
      
      const data = await performAnalysis(base64Data, mimeType);
      setResult(data);
    } catch (err: any) {
      console.error("Detection error:", err);
      let msg = err.message || 'Detection failed. Please try again.';
      if (msg.includes("API_KEY_INVALID")) {
        msg = "Invalid Gemini API Key. Please ensure your API key is correctly configured in the Secrets panel.";
      } else if (msg.includes("API_KEY_MISSING")) {
        msg = "Gemini API Key is missing. Please add 'GOOGLE_API_KEY' to the Secrets panel in AI Studio and restart the app.";
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const startLiveMode = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      setVideoStream(stream);
      setIsLiveMode(true);
      setPreview(null);
      setFile(null);
      setResult(null);
      setError(null);
    } catch (err: any) {
      setError("Camera access denied or not available. Please ensure you have granted camera permissions.");
      console.error(err);
    }
  };

  // Handle periodic analysis in live mode
  React.useEffect(() => {
    if (isLiveMode && videoStream) {
      analysisTimerRef.current = setInterval(async () => {
        if (liveVideoRef.current && liveVideoRef.current.readyState >= 2) {
          try {
            const frame = extractFrame(liveVideoRef.current);
            if (frame) {
              const data = await performAnalysis(frame, 'image/jpeg', true);
              setResult(data);
            }
          } catch (e) {
            console.error("Live analysis error:", e);
          }
        }
      }, 5000);
    }

    return () => {
      if (analysisTimerRef.current) {
        clearInterval(analysisTimerRef.current);
      }
    };
  }, [isLiveMode, videoStream]);

  const stopLiveMode = () => {
    if (videoStream) {
      videoStream.getTracks().forEach(track => track.stop());
    }
    if (analysisTimerRef.current) {
      clearInterval(analysisTimerRef.current);
    }
    setVideoStream(null);
    setIsLiveMode(false);
    setResult(null);
  };

  const reset = () => {
    stopLiveMode();
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center border border-emerald-500/20">
              <Shield className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">DEEPGUARD</h1>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">Neural Analysis System v4.2</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-xs font-medium text-zinc-400">
            <a href="#" className="hover:text-white transition-colors">DASHBOARD</a>
            <a href="#" className="hover:text-white transition-colors">HISTORY</a>
            <a href="#" className="hover:text-white transition-colors">DOCUMENTATION</a>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center gap-2 text-emerald-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              SYSTEM ACTIVE
            </div>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Upload & Preview */}
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-zinc-900/50 border border-white/5 rounded-3xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-zinc-500" />
                <h2 className="text-sm font-semibold uppercase tracking-wider">Input Stream</h2>
              </div>
              {file && (
                <button 
                  onClick={reset}
                  className="text-xs text-zinc-500 hover:text-white flex items-center gap-1 transition-colors"
                >
                  <RefreshCcw className="w-3 h-3" />
                  RESET
                </button>
              )}
            </div>

            <div className="p-8">
              {!preview && !isLiveMode ? (
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center gap-4 transition-all cursor-pointer",
                    isDragActive ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/10 hover:border-white/20 hover:bg-white/5"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center">
                    <Upload className="w-8 h-8 text-zinc-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">Drop media here or click to browse</p>
                    <p className="text-xs text-zinc-500 mt-1">Supports JPG, PNG, MP4, MOV (Max 50MB)</p>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden bg-black aspect-video flex items-center justify-center border border-white/10 group">
                  {isLiveMode ? (
                    <video 
                      ref={liveVideoRef}
                      autoPlay 
                      playsInline 
                      muted
                      className="max-h-full w-full object-cover scale-x-[-1]" 
                    />
                  ) : file?.type.startsWith('video/') ? (
                    <video 
                      ref={videoRef}
                      src={preview!} 
                      controls 
                      className="max-h-full" 
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <img src={preview!} alt="Preview" className="max-h-full object-contain" />
                  )}
                  
                  <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-2 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 hover:bg-black/80">
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Scanning Overlay */}
                  {(loading || isLiveMode) && (
                    <div className="absolute inset-0 pointer-events-none">
                      <div className="w-full h-1 bg-emerald-500/20 absolute top-0 overflow-hidden">
                        <motion.div 
                          className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                          animate={{ x: ['-100%', '100%'] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                        />
                      </div>
                      {loading && (
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center gap-4">
                          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                          <p className="text-sm font-mono text-emerald-500 animate-pulse uppercase tracking-widest">Analyzing Neural Artifacts...</p>
                        </div>
                      )}
                      {isLiveMode && !loading && (
                        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-full">
                          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-[10px] font-bold text-red-500 tracking-widest uppercase">Live Analysis Active</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-8 flex items-center justify-between">
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                      reset();
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = (e: any) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setFile(file);
                          setPreview(URL.createObjectURL(file));
                          setResult(null);
                          setError(null);
                        }
                      };
                      input.click();
                    }}
                    className={cn(
                      "flex items-center gap-2 text-xs transition-colors",
                      !isLiveMode && !file?.type.startsWith('video/') && file ? "text-emerald-500" : "text-zinc-500 hover:text-emerald-500"
                    )}
                  >
                    <ImageIcon className="w-3 h-3" />
                    IMAGE MODE
                  </button>
                  <button 
                    onClick={() => {
                      reset();
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'video/*';
                      input.onchange = (e: any) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setFile(file);
                          setPreview(URL.createObjectURL(file));
                          setResult(null);
                          setError(null);
                        }
                      };
                      input.click();
                    }}
                    className={cn(
                      "flex items-center gap-2 text-xs transition-colors",
                      file?.type.startsWith('video/') ? "text-emerald-500" : "text-zinc-500 hover:text-emerald-500"
                    )}
                  >
                    <FileVideo className="w-3 h-3" />
                    VIDEO MODE
                  </button>
                  <button 
                    onClick={() => {
                      if (isLiveMode) {
                        stopLiveMode();
                      } else {
                        startLiveMode();
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 text-xs transition-colors",
                      isLiveMode ? "text-emerald-500" : "text-zinc-500 hover:text-emerald-500"
                    )}
                  >
                    <Camera className="w-3 h-3" />
                    REAL-TIME MODE
                  </button>
                </div>
                {!isLiveMode && (
                  <button
                    disabled={!file || loading}
                    onClick={handleDetect}
                    className={cn(
                      "px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all",
                      !file || loading 
                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                        : "bg-emerald-500 text-black hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                    )}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    RUN DETECTION
                  </button>
                )}
                {isLiveMode && (
                  <button
                    onClick={stopLiveMode}
                    className="px-8 py-3 rounded-xl font-bold text-sm flex items-center gap-2 transition-all bg-red-500 text-white hover:bg-red-400"
                  >
                    <RefreshCcw className="w-4 h-4" />
                    STOP CAMERA
                  </button>
                )}
              </div>
            </div>
          </section>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400 text-sm"
            >
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              {error}
            </motion.div>
          )}
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-zinc-900/50 border border-white/5 rounded-3xl h-full flex flex-col">
            <div className="p-6 border-b border-white/5 flex items-center gap-2 bg-white/5">
              <Activity className="w-4 h-4 text-zinc-500" />
              <h2 className="text-sm font-semibold uppercase tracking-wider">Analysis Report</h2>
            </div>

            <div className="flex-1 p-8 flex flex-col">
              <AnimatePresence mode="wait">
                {!result ? (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex-1 flex flex-col items-center justify-center text-center space-y-4"
                  >
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center">
                      <Info className="w-10 h-10 text-zinc-700" />
                    </div>
                    <div className="max-w-[240px]">
                      <h3 className="text-sm font-medium text-zinc-400">Ready for Analysis</h3>
                      <p className="text-xs text-zinc-600 mt-2">Upload an image or video to begin deepfake detection using our neural processing engine.</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-8"
                  >
                    {/* Verdict Card */}
                    <div className={cn(
                      "p-6 rounded-2xl border flex items-center justify-between",
                      result.verdict === 'REAL' 
                        ? "bg-emerald-500/10 border-emerald-500/20" 
                        : "bg-red-500/10 border-red-500/20"
                    )}>
                      <div>
                        <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">System Verdict</p>
                        <h3 className={cn(
                          "text-3xl font-black tracking-tighter mt-1",
                          result.verdict === 'REAL' ? "text-emerald-500" : "text-red-500"
                        )}>
                          {result.verdict}
                        </h3>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Confidence</p>
                        <p className="text-2xl font-mono font-bold mt-1">{result.confidence}%</p>
                      </div>
                    </div>

                    {/* Confidence Bar */}
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                        <span>CONFIDENCE SCORE</span>
                        <span>{result.confidence}%</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${result.confidence}%` }}
                          transition={{ duration: 1, ease: "easeOut" }}
                          className={cn(
                            "h-full rounded-full",
                            result.verdict === 'REAL' ? "bg-emerald-500" : "bg-red-500"
                          )}
                        />
                      </div>
                    </div>

                    {/* Explanation */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        <Info className="w-3 h-3" />
                        AI Explanation
                      </div>
                      <p className="text-sm text-zinc-400 leading-relaxed italic">
                        "{result.explanation}"
                      </p>
                    </div>

                    {/* Suspicious Regions */}
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                        <AlertTriangle className="w-3 h-3" />
                        Detected Artifacts
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {result.suspiciousRegions.length > 0 ? (
                          result.suspiciousRegions.map((region, i) => (
                            <span 
                              key={i}
                              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-[11px] font-medium text-zinc-300"
                            >
                              {region}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-zinc-500 italic">No significant artifacts detected.</span>
                        )}
                      </div>
                    </div>

                    {/* Action Footer */}
                    <div className="pt-6 border-t border-white/5">
                      <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10">
                        {result.verdict === 'REAL' ? (
                          <CheckCircle className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-red-500" />
                        )}
                        <p className="text-xs text-zinc-400">
                          {result.verdict === 'REAL' 
                            ? "This media shows no signs of neural manipulation." 
                            : "Neural artifacts detected. High probability of synthetic generation."}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-500" />
              <span className="font-bold tracking-tight">DEEPGUARD</span>
            </div>
            <p className="text-sm text-zinc-500 max-w-sm">
              DeepGuard is a state-of-the-art deepfake detection platform leveraging advanced neural networks to protect digital integrity.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-4">Technology</h4>
            <ul className="space-y-2 text-xs text-zinc-500">
              <li>EfficientNet-B4</li>
              <li>MTCNN Face Detection</li>
              <li>Grad-CAM Visualization</li>
              <li>Temporal Analysis</li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-4">Company</h4>
            <ul className="space-y-2 text-xs text-zinc-500">
              <li>About Us</li>
              <li>Privacy Policy</li>
              <li>Terms of Service</li>
              <li>Contact Support</li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            © 2026 DEEPGUARD NEURAL SYSTEMS. ALL RIGHTS RESERVED.
          </p>
          <div className="flex gap-6 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            <a href="#" className="hover:text-white transition-colors">Twitter</a>
            <a href="#" className="hover:text-white transition-colors">GitHub</a>
            <a href="#" className="hover:text-white transition-colors">LinkedIn</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
