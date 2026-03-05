import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Video, 
  Download, 
  Trash2, 
  History, 
  Sparkles, 
  AlertTriangle, 
  Loader2,
  Image as ImageIcon,
  Plus,
  Info,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { openDB, IDBPDatabase } from 'idb';
import Fuse from 'fuse.js';

// --- Constants & Types ---
const DB_NAME = 'AIMediaLab';
const STORE_NAME = 'generations';
const DAILY_LIMIT = 15;

type ImageProvider = 'gemini' | 'pollinations' | 'seaart' | 'craiyon' | 'leonardo' | 'tensor';
type VideoProvider = 'veo' | 'kling' | 'kie' | 'aiml' | 'seedance' | 'luma' | 'pika';

interface ProviderInfo {
  id: string;
  name: string;
  category: 'Internal' | 'Truly Free' | 'Trial-Based' | 'Community' | 'Aggregator';
  bestUse: string;
  limits: string;
  requiresKey?: boolean;
}

const IMAGE_PROVIDERS: ProviderInfo[] = [
  { id: 'gemini', name: 'Gemini 2.5', category: 'Internal', bestUse: 'High-fidelity photorealistic images', limits: '15 RPM / 1M TPM (Free Tier)' },
  { id: 'pollinations', name: 'Pollinations', category: 'Truly Free', bestUse: 'Fast, unlimited "No-Key" images (Flux)', limits: 'Truly Unlimited / No Auth' },
  { id: 'craiyon', name: 'Craiyon', category: 'Truly Free', bestUse: 'Ad-supported, unlimited simple images', limits: 'Unlimited (Ad-Supported)' },
  { id: 'leonardo', name: 'Leonardo.ai', category: 'Trial-Based', bestUse: '150 daily credits, high-end artistic control', limits: '150 Tokens Daily (Refreshes)', requiresKey: true },
  { id: 'tensor', name: 'Tensor.art', category: 'Community', bestUse: 'Daily free credits, massive model library', limits: '100 Credits Daily', requiresKey: true },
  { id: 'seaart', name: 'SeaArt', category: 'Community', bestUse: 'Artistic & community-driven styles', limits: 'Daily Credits (Check-in)', requiresKey: true },
];

const VIDEO_PROVIDERS: ProviderInfo[] = [
  { id: 'veo', name: 'Google Veo', category: 'Internal', bestUse: 'High-quality cinematic video', limits: 'Paid Key Required' },
  { id: 'luma', name: 'Luma Dream Machine', category: 'Trial-Based', bestUse: '30 free generations/month, high realism', limits: '30 Free / Month', requiresKey: true },
  { id: 'pika', name: 'Pika Art', category: 'Trial-Based', bestUse: 'Daily free credits, great for animation', limits: '30 Credits Daily', requiresKey: true },
  { id: 'kie', name: 'Kie.ai (Kling)', category: 'Trial-Based', bestUse: 'Kling 2.5 Turbo (Trial credits)', limits: 'Limited Trial Credits', requiresKey: true },
  { id: 'aiml', name: 'AIML API', category: 'Aggregator', bestUse: 'Unified access to multiple models', limits: 'Pay-as-you-go', requiresKey: true },
  { id: 'seedance', name: 'Seedance', category: 'Community', bestUse: 'High-speed video previews', limits: 'Daily Free Tasks', requiresKey: true },
];

interface Generation {
  id: string;
  type: 'image' | 'video';
  provider: string;
  prompt: string;
  url: string;
  timestamp: number;
}

// --- Database Helper ---
const initDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
};

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// --- Main Component ---
export default function App() {
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');
  const [imageProvider, setImageProvider] = useState<ImageProvider>('gemini');
  const [videoProvider, setVideoProvider] = useState<VideoProvider>('veo');
  const [prompt, setPrompt] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [dailyCount, setDailyCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [refiningGen, setRefiningGen] = useState<Generation | null>(null);

  const dbRef = useRef<IDBPDatabase | null>(null);

  // Fuse.js for searching through archive
  const fuse = useMemo(() => new Fuse(generations, {
    keys: ['prompt', 'type', 'provider'],
    threshold: 0.3
  }), [generations]);

  const filteredGenerations = useMemo(() => {
    if (!searchQuery) return generations;
    return fuse.search(searchQuery).map(result => result.item);
  }, [searchQuery, generations, fuse]);

  useEffect(() => {
    const setup = async () => {
      dbRef.current = await initDB();
      await loadGenerations();
      await checkDailyLimit();
      
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    setup();
  }, []);

  const loadGenerations = async () => {
    if (!dbRef.current) return;
    const all = await dbRef.current.getAll(STORE_NAME);
    setGenerations(all.sort((a, b) => b.timestamp - a.timestamp));
  };

  const checkDailyLimit = async () => {
    if (!dbRef.current) return;
    const all = await dbRef.current.getAll(STORE_NAME);
    const today = new Date().setHours(0, 0, 0, 0);
    const count = all.filter(g => new Date(g.timestamp).setHours(0, 0, 0, 0) === today).length;
    setDailyCount(count);
  };

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  const urlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const generateImage = async (promptText: string, provider: ImageProvider, reference?: Generation) => {
    if (provider === 'pollinations') {
      const seed = Math.floor(Math.random() * 1000000);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=1024&height=1024&seed=${seed}&model=flux&nologo=true`;
      
      // Fetch the image to ensure it's actually generated and ready
      // This makes the "Generating..." state meaningful and less "sloppy"
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Pollinations API returned ${response.status}`);
        // We don't strictly need the blob, but fetching it ensures the image is cached/ready
        await response.blob();
        return url;
      } catch (e: any) {
        console.warn('Pollinations fetch warning:', e);
        // If it's a CORS error, we still return the URL because the browser <img> tag 
        // might still be able to load it even if fetch() can't (due to different CORS rules for <img>)
        return url;
      }
    }

    if (provider === 'craiyon') {
      throw new Error('Craiyon integration requires ad-supported web scraping or a specific API. Use Pollinations for truly free generation.');
    }

    if (provider === 'leonardo' || provider === 'tensor' || provider === 'seaart') {
      const keyName = provider.toUpperCase() + '_API_KEY';
      const key = (process.env as any)[`VITE_${keyName}`] || (process.env as any)[keyName];
      if (!key) {
        throw new Error(`${provider.charAt(0).toUpperCase() + provider.slice(1)} requires an API key. Please add ${keyName} to your environment.`);
      }
      throw new Error(`${provider.charAt(0).toUpperCase() + provider.slice(1)} integration is in progress. Please use Gemini or Pollinations for now.`);
    }

    // Default: Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const parts: any[] = [{ text: promptText }];

    if (reference && reference.type === 'image') {
      try {
        const base64 = await urlToBase64(reference.url);
        parts.unshift({
          inlineData: {
            data: base64,
            mimeType: 'image/png'
          }
        });
      } catch (e) {
        console.warn('Could not load reference image for refinement, proceeding with text only.', e);
      }
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts },
      config: { imageConfig: { aspectRatio: "1:1" } }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    throw new Error('No image data returned from Gemini');
  };

  const generateVideo = async (promptText: string, provider: VideoProvider, reference?: Generation) => {
    if (provider === 'luma' || provider === 'pika' || provider === 'kie' || provider === 'aiml' || provider === 'seedance') {
      const keyName = provider.toUpperCase() + '_API_KEY';
      const key = (process.env as any)[`VITE_${keyName}`] || (process.env as any)[keyName];
      
      if (provider === 'seedance') {
        throw new Error('Seedance/SeaArt often require daily check-in credits. Direct API integration is restricted. Use Veo for now.');
      }

      if (!key) {
        const instructions: Record<string, string> = {
          luma: 'Sign up at lumalabs.ai for 30 free monthly generations.',
          pika: 'Sign up at pika.art for daily free credits.',
          kie: 'Sign up at Kie.ai for free Kling 2.5 Turbo credits.',
          aiml: 'Get a key at aimlapi.com for aggregator access.'
        };
        throw new Error(`${provider.toUpperCase()} API Key is missing. ${instructions[provider] || ''}`);
      }
      
      throw new Error(`${provider.toUpperCase()} integration requires a server-side proxy for secure API calls. Use Veo for now.`);
    }

    // Default: Veo
    if (!hasApiKey) {
      throw new Error('Please select an API key for video generation.');
    }

    const apiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY;
    const ai = new GoogleGenAI({ apiKey });
    
    const videoConfig: any = {
      model: 'veo-3.1-fast-generate-preview',
      prompt: promptText,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    };

    if (reference) {
      if (reference.type === 'image') {
        const base64 = await urlToBase64(reference.url);
        videoConfig.image = {
          imageBytes: base64,
          mimeType: 'image/png'
        };
      } else if (reference.type === 'video') {
        // For video extension, we need the original video object or URI
        // Since we only have the blob URL, we might need to store the original URI if available
        // For now, we'll treat it as a starting frame if we can extract one, or just prompt context
        setStatusMessage('Preparing video context...');
      }
    }

    let operation = await ai.models.generateVideos(videoConfig);

    setStatusMessage('Initializing video engine...');
    while (!operation.done) {
      setStatusMessage('Crafting frames... this may take a few minutes.');
      await new Promise(resolve => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error('Video generation failed: No download link returned.');

    try {
      const response = await fetch(downloadLink, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err: any) {
      console.error('Video fetch error:', err);
      if (err.message === 'Failed to fetch') {
        throw new Error('Network error or CORS restriction when downloading video. This can happen if the video host blocks browser-side downloads.');
      }
      throw err;
    }
  };

  const handleGenerate = async () => {
    if (dailyCount >= DAILY_LIMIT) {
      setError(`Daily limit of ${DAILY_LIMIT} reached. Try again tomorrow!`);
      return;
    }
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError(null);
    const currentProvider = activeTab === 'image' ? imageProvider : videoProvider;
    setStatusMessage(`Connecting to ${currentProvider}...`);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is missing from the environment. Please ensure it is set.');
      }

      let url = '';
      if (activeTab === 'image') {
        setStatusMessage(`Generating image with ${currentProvider}...`);
        url = await generateImage(prompt, imageProvider);
      } else {
        setStatusMessage(`Synthesizing video with ${currentProvider}...`);
        url = await generateVideo(prompt, videoProvider);
      }

      const newGen: Generation = {
        id: crypto.randomUUID(),
        type: activeTab,
        provider: currentProvider,
        prompt: prompt,
        url: url,
        timestamp: Date.now(),
      };

      if (dbRef.current) {
        await dbRef.current.add(STORE_NAME, newGen);
      }

      setGenerations([newGen, ...generations]);
      setDailyCount(prev => prev + 1);
      setPrompt('');
      setStatusMessage('Success!');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Generation failed. Please try again.');
    } finally {
      setIsGenerating(false);
      setStatusMessage('');
    }
  };

  const deleteGeneration = async (id: string) => {
    if (!dbRef.current) return;
    await dbRef.current.delete(STORE_NAME, id);
    setGenerations(generations.filter(g => g.id !== id));
  };

  const downloadFile = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const currentProviderInfo = activeTab === 'image' 
    ? IMAGE_PROVIDERS.find(p => p.id === imageProvider) 
    : VIDEO_PROVIDERS.find(p => p.id === videoProvider);

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-4">
        <div>
          <h1 className="text-4xl font-black tracking-tighter flex items-center gap-3">
            <Sparkles className="text-accent-orange w-10 h-10" />
            AI <span className="text-accent-orange">MEDIA LAB</span>
          </h1>
          <p className="text-slate-400 font-medium mt-1">Multi-Provider Image & Video Generation</p>
        </div>
        
        <div className="flex items-center gap-4 bg-slate-800/50 px-4 py-2 rounded-full border border-white/5">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${dailyCount >= DAILY_LIMIT ? 'bg-red-500' : 'bg-green-500'}`} />
            <span className="text-sm font-bold">
              {dailyCount}/{DAILY_LIMIT} Daily Credits
            </span>
          </div>
          <div className="w-[1px] h-4 bg-white/10" />
          <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">Smart Routing</span>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Control Panel */}
        <div className="lg:col-span-5 space-y-6">
          <div className="glass-panel p-6 space-y-6">
            {/* Tab Selector */}
            <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setActiveTab('image')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
                  activeTab === 'image' 
                    ? 'bg-accent-orange text-white shadow-lg shadow-orange-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ImageIcon size={18} />
                Image
              </button>
              <button
                onClick={() => setActiveTab('video')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${
                  activeTab === 'video' 
                    ? 'bg-accent-orange text-white shadow-lg shadow-orange-500/20' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Video size={18} />
                Video
              </button>
            </div>

            {/* Provider Selection with Categories */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">
                  Select Provider
                </label>
                {currentProviderInfo && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    currentProviderInfo.category === 'Truly Free' ? 'bg-green-500/20 text-green-400' :
                    currentProviderInfo.category === 'Internal' ? 'bg-blue-500/20 text-blue-400' :
                    currentProviderInfo.category === 'Trial-Based' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-purple-500/20 text-purple-400'
                  }`}>
                    {currentProviderInfo.category}
                  </span>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                {(activeTab === 'image' ? IMAGE_PROVIDERS : VIDEO_PROVIDERS).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => activeTab === 'image' ? setImageProvider(p.id as ImageProvider) : setVideoProvider(p.id as VideoProvider)}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all text-left flex flex-col gap-0.5 ${
                      (activeTab === 'image' ? imageProvider : videoProvider) === p.id 
                        ? 'bg-accent-orange/10 border-accent-orange text-accent-orange' 
                        : 'bg-slate-900/50 border-white/5 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    <span>{p.name}</span>
                    <span className="text-[9px] opacity-60 font-medium line-clamp-1">{p.bestUse}</span>
                    <span className="text-[8px] mt-0.5 font-black uppercase tracking-widest opacity-40">{p.limits}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Refinement Preview */}
            {refiningGen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="bg-accent-orange/10 border border-accent-orange/20 p-3 rounded-xl flex items-center gap-3 relative overflow-hidden"
              >
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-900 shrink-0">
                  {refiningGen.type === 'image' ? (
                    <img src={refiningGen.url} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <video src={refiningGen.url} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-accent-orange">Refining Mode</p>
                  <p className="text-[11px] text-slate-400 line-clamp-2 italic">"{refiningGen.prompt}"</p>
                </div>
                <button 
                  onClick={() => setRefiningGen(null)}
                  className="absolute top-2 right-2 text-slate-500 hover:text-white transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </motion.div>
            )}

            {/* Prompt Input */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">
                Creative Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={activeTab === 'image' 
                  ? "e.g. A futuristic city at sunset with neon lights and flying vehicles, cinematic style..." 
                  : "e.g. A slow motion shot of a waterfall in a lush tropical jungle, 4k resolution..."
                }
                className="w-full h-32 bg-slate-900/50 border border-white/10 rounded-xl p-4 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-accent-orange/50 transition-colors resize-none"
              />
            </div>

            {/* Key Warnings */}
            {currentProviderInfo?.requiresKey && (
              <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-xl flex items-start gap-3">
                <AlertTriangle className="text-orange-500 shrink-0" size={20} />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-orange-200">
                    {currentProviderInfo.name} requires an API key.
                  </p>
                  <p className="text-[10px] text-orange-300/70">
                    Add {currentProviderInfo.id.toUpperCase()}_API_KEY to your environment variables.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'video' && videoProvider === 'veo' && !hasApiKey && (
              <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-xl flex items-start gap-3">
                <AlertTriangle className="text-orange-500 shrink-0" size={20} />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-orange-200">
                    Veo requires a paid API key selection.
                  </p>
                  <button 
                    onClick={handleOpenKeyDialog}
                    className="text-xs font-black uppercase tracking-widest bg-orange-500 text-white px-3 py-1.5 rounded-md hover:bg-orange-600 transition-colors"
                  >
                    Select Key
                  </button>
                </div>
              </div>
            )}

            {/* Action Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim() || dailyCount >= DAILY_LIMIT || (activeTab === 'video' && videoProvider === 'veo' && !hasApiKey)}
              className="w-full orange-gradient py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Plus size={20} />
                  Generate {activeTab}
                </>
              )}
            </button>

            {/* Status & Error */}
            <AnimatePresence mode="wait">
              {statusMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex items-center gap-2 text-sm text-slate-400 justify-center"
                >
                  <Loader2 className="animate-spin w-4 h-4" />
                  {statusMessage}
                </motion.div>
              )}
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg text-red-400 text-sm flex items-center gap-2"
                >
                  <AlertTriangle size={16} />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Tips & Guide */}
          <div className="space-y-4">
            <div className="glass-panel p-4 flex items-start gap-3">
              <Info className="text-accent-orange shrink-0" size={18} />
              <div className="text-xs text-slate-400 leading-relaxed">
                <span className="font-bold text-slate-200">Provider Info:</span> 
                <p className="mt-1">{currentProviderInfo?.bestUse}</p>
              </div>
            </div>

            <div className="glass-panel p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-200 flex items-center gap-2">
                <Sparkles size={14} className="text-accent-orange" />
                Free Tier Guide
              </h3>
              <div className="space-y-2">
                {[...IMAGE_PROVIDERS, ...VIDEO_PROVIDERS]
                  .filter((p, i, self) => self.findIndex(t => t.category === p.category) === i)
                  .map(cat => (
                    <div key={cat.category} className="space-y-1">
                      <h4 className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{cat.category}</h4>
                      {[...IMAGE_PROVIDERS, ...VIDEO_PROVIDERS]
                        .filter(p => p.category === cat.category)
                        .map(p => (
                          <div key={p.id} className="flex justify-between text-[10px] items-center">
                            <span className="text-slate-400">{p.name}</span>
                            <span className={`font-bold ${
                              p.category === 'Truly Free' ? 'text-green-400' :
                              p.category === 'Internal' ? 'text-blue-400' :
                              'text-orange-400'
                            }`}>{p.limits}</span>
                          </div>
                        ))
                      }
                    </div>
                  ))
                }
              </div>
              <p className="text-[9px] text-slate-500 leading-tight border-t border-white/5 pt-2">
                Most providers use a "Freemium" model. Use Truly Free options when you run out of credits elsewhere.
              </p>
            </div>
          </div>
        </div>

        {/* Gallery */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
              <History className="text-accent-orange" />
              MEDIA ARCHIVE
            </h2>
            
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
              <input 
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search archive..."
                className="w-full bg-slate-800/50 border border-white/5 rounded-full py-2 pl-9 pr-4 text-xs focus:outline-none focus:border-accent-orange/30 transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredGenerations.map((gen) => (
                <motion.div
                  key={gen.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="glass-panel overflow-hidden group"
                >
                  <div 
                    className="aspect-square bg-slate-800 relative cursor-pointer group/card"
                    onClick={() => {
                      setRefiningGen(gen);
                      setActiveTab(gen.type);
                      setPrompt(`Refine this ${gen.type}: `);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    {gen.type === 'image' ? (
                      <img 
                        src={gen.url} 
                        alt={gen.prompt} 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <video 
                        src={gen.url} 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110"
                        controls={false}
                      />
                    )}
                    
                    {/* Overlay Controls */}
                    <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover/card:opacity-100 transition-opacity flex flex-col justify-between p-4 backdrop-blur-[2px]">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Sparkles size={14} className="text-accent-orange" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-white">Agentic Refinement</span>
                        </div>
                        <p className="text-xs text-slate-200 line-clamp-3 font-medium leading-relaxed">
                          {gen.prompt}
                        </p>
                        <span className="text-[10px] font-bold text-accent-orange/80 uppercase tracking-widest">
                          via {gen.provider}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            setRefiningGen(gen);
                            setActiveTab(gen.type);
                            setPrompt(`Refine this ${gen.type}: `);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="flex-1 bg-accent-orange text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-orange-600 transition-colors"
                        >
                          <Sparkles size={14} />
                          Refine
                        </button>
                        <button
                          onClick={() => downloadFile(gen.url, `ai-media-${gen.type}-${gen.id}.${gen.type === 'image' ? 'png' : 'mp4'}`)}
                          className="flex-1 bg-white text-slate-900 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors"
                        >
                          <Download size={14} />
                          Save
                        </button>
                        <button
                          onClick={() => deleteGeneration(gen.id)}
                          className="w-10 h-10 bg-red-500/20 text-red-500 rounded-lg flex items-center justify-center hover:bg-red-500 hover:text-white transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Type Badge */}
                    <div className="absolute top-2 left-2 px-2 py-1 bg-slate-900/80 backdrop-blur-sm rounded-md border border-white/10 flex items-center gap-1.5">
                      {gen.type === 'image' ? <ImageIcon size={12} className="text-accent-orange" /> : <Video size={12} className="text-accent-orange" />}
                      <span className="text-[10px] font-black uppercase tracking-widest">{gen.type}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {filteredGenerations.length === 0 && (
              <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-600 space-y-4">
                <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center border border-white/5">
                  {searchQuery ? <Search size={32} /> : <ImageIcon size={32} />}
                </div>
                <p className="font-bold uppercase tracking-widest text-sm">
                  {searchQuery ? 'No matches found' : 'No generations yet'}
                </p>
                <p className="text-xs max-w-[200px] text-center leading-relaxed">
                  {searchQuery ? 'Try a different search term or clear the filter.' : 'Start by entering a prompt to visualize your ideas.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-slate-500">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-orange flex items-center justify-center text-white font-black text-xs">AI</div>
          <span className="text-xs font-bold uppercase tracking-widest">AI Media Lab</span>
        </div>
        <div className="flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest">
          <a href="#" className="hover:text-accent-orange transition-colors">Privacy</a>
          <a href="#" className="hover:text-accent-orange transition-colors">Terms</a>
          <a href="#" className="hover:text-accent-orange transition-colors">Support</a>
        </div>
      </footer>
    </div>
  );
}
