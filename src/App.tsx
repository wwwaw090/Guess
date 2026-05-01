import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, 
  Trophy, 
  RotateCcw, 
  Award, 
  PlusCircle, 
  Send, 
  Eye, 
  User,
  Copy,
  CheckCircle2
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Peer, DataConnection } from 'peerjs';
import { questionCategories, avatars } from './data/questions';

type Player = {
  id: string;
  name: string;
  avatar: string;
  score: number;
  isReady: boolean;
  lastAnswer?: string;
};

type GameStatus = 'waiting' | 'answering' | 'guessing' | 'revealing' | 'results';

type GameState = {
  status: GameStatus;
  category: string;
  currentQuestionIndex: number;
  questionIds: string[];
  players: Player[];
  targetPlayerId?: string;
};

export default function App() {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [conn, setConn] = useState<DataConnection | null>(null); // For guests
  const [connections, setConnections] = useState<DataConnection[]>([]); // For host
  
  const [myId, setMyId] = useState("");
  const [playerName, setPlayerName] = useState(localStorage.getItem('playerName') || '');
  const [isHost, setIsHost] = useState(false);
  
  const [gameState, setGameState] = useState<GameState>({
    status: 'waiting',
    category: '',
    currentQuestionIndex: 0,
    questionIds: [],
    players: []
  });

  const [localPlayer, setLocalPlayer] = useState<Player | null>(null);
  const [error, setError] = useState("");

  // Initialize Peer
  useEffect(() => {
    const newPeer = new Peer();
    newPeer.on('open', (id) => {
      setMyId(id);
    });
    
    newPeer.on('error', (err) => {
      console.error(err);
      setError("حدث خطأ في الاتصال: " + err.type);
    });

    setPeer(newPeer);
    return () => newPeer.destroy();
  }, []);

  // Host Logic: Listen for connections
  useEffect(() => {
    if (peer && isHost) {
      peer.on('connection', (newConn) => {
        newConn.on('data', (data: any) => {
          handleIncomingData(data, newConn);
        });
        setConnections(prev => [...prev, newConn]);
      });
    }
  }, [peer, isHost]);

  // Handle Incoming Data (Both Host and Guest)
  const handleIncomingData = (data: any, fromConn?: DataConnection) => {
    if (data.type === 'JOIN') {
      if (isHost) {
        const newPlayer: Player = { ...data.player, id: fromConn!.peer };
        setGameState(prev => {
          const newState = { ...prev, players: [...prev.players, newPlayer] };
          broadcastState(newState);
          return newState;
        });
      }
    } else if (data.type === 'STATE_UPDATE') {
      setGameState(data.state);
    } else if (data.type === 'SUBMIT_ANSWER') {
      if (isHost) {
        updatePlayerInState(fromConn!.peer, { lastAnswer: data.answer, isReady: true });
      }
    } else if (data.type === 'SUBMIT_GUESS') {
      if (isHost) {
        handleGuessFromPlayer(fromConn!.peer, data.guessedId);
      }
    }
  };

  const broadcastState = (state: GameState) => {
    connections.forEach(c => c.send({ type: 'STATE_UPDATE', state }));
  };

  const updatePlayerInState = (id: string, updates: Partial<Player>) => {
    setGameState(prev => {
      const newPlayers = prev.players.map(p => p.id === id ? { ...p, ...updates } : p);
      const newState = { ...prev, players: newPlayers };
      
      // Check if all ready for guessing
      if (newState.status === 'answering' && newPlayers.every(p => p.isReady)) {
        startGuessingPhase(newState);
        return newState; // startGuessingPhase will broadcast
      }
      
      broadcastState(newState);
      return newState;
    });
  };

  const startGuessingPhase = (currentState: GameState) => {
    const targetPlayer = currentState.players[Math.floor(Math.random() * currentState.players.length)];
    const newState: GameState = {
      ...currentState,
      status: 'guessing',
      targetPlayerId: targetPlayer.id,
      players: currentState.players.map(p => ({ ...p, isReady: false }))
    };
    setGameState(newState);
    broadcastState(newState);
  };

  const handleGuessFromPlayer = (guesserId: string, guessedId: string) => {
    setGameState(prev => {
      const isCorrect = guessedId === prev.targetPlayerId;
      const newPlayers = prev.players.map(p => 
        p.id === guesserId ? { ...p, score: isCorrect ? p.score + 10 : p.score, isReady: true } : p
      );
      
      const newState = { ...prev, players: newPlayers };
      
      if (newPlayers.every(p => p.isReady)) {
        newState.status = 'revealing';
        broadcastState(newState);
        setTimeout(() => nextRound(newState), 4000);
      } else {
        broadcastState(newState);
      }
      
      return newState;
    });
  };

  const nextRound = (currentState: GameState) => {
    const nextIdx = currentState.currentQuestionIndex + 1;
    if (nextIdx < currentState.questionIds.length) {
      const newState: GameState = {
        ...currentState,
        status: 'answering',
        currentQuestionIndex: nextIdx,
        players: currentState.players.map(p => ({ ...p, isReady: false, lastAnswer: '' })),
        targetPlayerId: undefined
      };
      setGameState(newState);
      broadcastState(newState);
    } else {
      const newState: GameState = { ...currentState, status: 'results' };
      setGameState(newState);
      broadcastState(newState);
      confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }
  };

  // Actions
  const createRoom = (category: string) => {
    setIsHost(true);
    const questions = questionCategories[category as keyof typeof questionCategories];
    const qIds = [...Array(questions.length).keys()].sort(() => Math.random() - 0.5).slice(0, 5).map(String);
    
    const hostPlayer: Player = {
      id: myId,
      name: playerName || "المضيف",
      avatar: avatars[Math.floor(Math.random() * avatars.length)],
      score: 0,
      isReady: false
    };

    const initialState: GameState = {
      status: 'waiting',
      category,
      currentQuestionIndex: 0,
      questionIds: qIds,
      players: [hostPlayer]
    };
    
    setGameState(initialState);
    setLocalPlayer(hostPlayer);
  };

  const joinRoom = (targetId: string) => {
    if (!peer) return;
    const newConn = peer.connect(targetId.trim());
    setConn(newConn);
    
    newConn.on('open', () => {
      const guestPlayer: Player = {
        id: myId,
        name: playerName || "لاعب",
        avatar: avatars[Math.floor(Math.random() * avatars.length)],
        score: 0,
        isReady: false
      };
      setLocalPlayer(guestPlayer);
      newConn.send({ type: 'JOIN', player: guestPlayer });
    });

    newConn.on('data', (data: any) => {
      handleIncomingData(data);
    });

    newConn.on('error', () => setError("فشل الاتصال بالغرفة"));
  };

  const submitAnswer = (answer: string) => {
    if (isHost) {
      updatePlayerInState(myId, { lastAnswer: answer, isReady: true });
    } else if (conn) {
      conn.send({ type: 'SUBMIT_ANSWER', answer });
    }
  };

  const submitGuess = (guessedId: string) => {
    if (isHost) {
      handleGuessFromPlayer(myId, guessedId);
    } else if (conn) {
      conn.send({ type: 'SUBMIT_GUESS', guessedId });
    }
  };

  const startActualGame = () => {
    const newState = { ...gameState, status: 'answering' as GameStatus };
    setGameState(newState);
    broadcastState(newState);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans dir-rtl selection:bg-indigo-500/30">
      <div className="max-w-md mx-auto px-4 py-8 h-screen flex flex-col">
        {error && (
          <div className="fixed top-4 inset-x-4 bg-red-500 p-4 rounded-2xl z-50 text-center font-bold shadow-2xl animate-bounce">
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {gameState.status === 'waiting' && !localPlayer && (
            <Landing 
              myId={myId}
              onJoin={joinRoom} 
              onCreate={createRoom} 
              name={playerName} 
              setName={(n: string) => { setPlayerName(n); localStorage.setItem('playerName', n); }} 
            />
          )}

          {gameState.status === 'waiting' && localPlayer && (
            <Lobby 
              room={gameState} 
              isHost={isHost} 
              onStart={startActualGame} 
              hostId={isHost ? myId : conn?.peer || ""}
            />
          )}

          {gameState.status !== 'waiting' && (
            <Game 
              gameState={gameState}
              myId={myId}
              onAnswer={submitAnswer}
              onGuess={submitGuess}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// --- Sub Components ---

function Landing({ onJoin, onCreate, name, setName, myId }: any) {
  const [code, setCode] = useState("");
  const [showCategories, setShowCategories] = useState(false);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex-1 flex flex-col justify-center gap-8">
      <div className="text-center">
        <h1 className="text-7xl font-black italic mb-2 tracking-tighter drop-shadow-2xl text-transparent bg-clip-text bg-gradient-to-b from-white to-indigo-400">خمنّي!</h1>
        <p className="text-indigo-300/80 text-lg font-medium">العب مع أحبابك أونلاين مجاناً 🚀</p>
      </div>

      <div className="space-y-6 bg-white/5 backdrop-blur-2xl p-8 rounded-[3rem] border border-white/10 shadow-2xl">
        <div className="space-y-2">
          <label className="text-xs font-black text-indigo-400 mr-2 uppercase tracking-widest">من أنت؟</label>
          <div className="flex bg-white/5 rounded-2xl overflow-hidden p-1 border border-white/10 focus-within:border-indigo-500 transition-all">
            <div className="p-4 bg-indigo-600 rounded-xl shadow-lg"><User size={24} /></div>
            <input 
              value={name} 
              onChange={e => setName(e.target.value)}
              className="bg-transparent border-none outline-none px-4 flex-1 font-bold text-xl placeholder:text-white/10"
              placeholder="اسمك هنا..."
            />
          </div>
        </div>

        {!showCategories ? (
          <div className="space-y-6">
             <div className="space-y-3">
                <p className="text-xs font-black text-indigo-400 mr-2 uppercase tracking-widest">انضمام لغرفة</p>
                <div className="flex gap-2">
                  <input 
                    value={code} 
                    onChange={e => setCode(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-2xl px-4 py-4 flex-1 text-center font-mono font-bold text-lg focus:border-indigo-500 outline-none"
                    placeholder="رمز الغرفة"
                  />
                  <button 
                    onClick={() => name ? onJoin(code) : alert("سجل اسمك أولاً")}
                    className="bg-indigo-600 hover:bg-indigo-500 px-6 rounded-2xl font-black transition-all active:scale-95 shadow-lg"
                  >
                    دخول
                  </button>
                </div>
             </div>

             <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-white/5"></div>
                <span className="absolute bg-[#0f172a] px-4 text-[10px] font-black text-white/20 uppercase tracking-[0.2em]">أو</span>
             </div>

             <button 
                onClick={() => name ? setShowCategories(true) : alert("سجل اسمك أولاً")}
                className="w-full bg-white text-indigo-950 py-6 rounded-[2rem] font-black text-2xl flex items-center justify-center gap-3 shadow-2xl hover:scale-[1.02] active:scale-95 transition-all"
             >
                <PlusCircle size={28} /> إنشاء غرفة
             </button>
          </div>
        ) : (
          <div className="space-y-4">
             <div className="flex items-center justify-between mb-2">
                <p className="font-black text-xl">اختر المجموعة</p>
                <button onClick={() => setShowCategories(false)} className="text-indigo-400 text-sm font-bold">رجوع</button>
             </div>
             <div className="grid gap-3">
               {Object.keys(questionCategories).map(cat => (
                 <button 
                   key={cat}
                   onClick={() => onCreate(cat)}
                   className="w-full bg-white/5 hover:bg-indigo-600 border border-white/10 p-5 rounded-[1.5rem] text-right font-bold flex justify-between items-center transition-all group"
                 >
                   <span>{cat}</span>
                   <Play size={18} fill="currentColor" />
                 </button>
               ))}
             </div>
          </div>
        )}
      </div>

      <div className="text-center opacity-20 text-[10px] font-black tracking-widest uppercase">
        ID: {myId || "جاري التحميل..."}
      </div>
    </motion.div>
  );
}

function Lobby({ room, isHost, onStart, hostId }: any) {
  const [copied, setCopied] = useState(false);
  const players = room.players;

  const copyId = () => {
    navigator.clipboard.writeText(hostId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
      <div className="text-center mb-8">
        <p className="text-indigo-400 text-sm font-black mb-3 uppercase tracking-widest">رمز الغرفة للمشاركة</p>
        <button 
          onClick={copyId}
          className="group relative bg-white/5 border border-white/10 px-8 py-4 rounded-3xl font-mono text-3xl font-black shadow-2xl hover:bg-white/10 transition-all active:scale-95"
        >
          {hostId.substring(0, 6)}
          <div className="absolute -right-3 -top-3 bg-indigo-600 p-2 rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform">
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
          </div>
        </button>
      </div>

      <div className="bg-white/5 backdrop-blur-xl p-8 rounded-[3rem] border border-white/10 flex-1 mb-8 overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black">اللاعبون ({players.length})</h2>
          <div className="flex gap-1">
             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse delay-75"></div>
             <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse delay-150"></div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <AnimatePresence>
            {players.map((p: any) => (
              <motion.div 
                key={p.id}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-white/5 border border-white/10 p-5 rounded-[2rem] flex flex-col items-center gap-3 relative group"
              >
                <span className="text-5xl group-hover:scale-110 transition-transform">{p.avatar}</span>
                <span className="font-black text-lg truncate w-full text-center">{p.name}</span>
                {p.id === hostId && <div className="absolute top-2 right-2 text-yellow-400 text-[10px] font-black bg-yellow-400/10 px-2 py-0.5 rounded-full border border-yellow-400/20">HOST</div>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {isHost ? (
        <button 
          onClick={onStart}
          disabled={players.length < 2}
          className={`w-full py-6 rounded-[2rem] font-black text-2xl shadow-2xl transition-all ${
            players.length < 2 ? 'bg-white/5 text-white/20' : 'bg-white text-indigo-950 hover:scale-[1.02] active:scale-95'
          }`}
        >
          {players.length < 2 ? 'بانتظار شخص واحد على الأقل...' : 'ابدأ الحين!'}
        </button>
      ) : (
        <div className="text-center p-8 bg-white/5 rounded-[2.5rem] border border-white/5 animate-pulse">
          <p className="text-indigo-300 font-black text-xl">بانتظار المضيف يبدأ...</p>
        </div>
      )}
    </motion.div>
  );
}

function Game({ gameState, myId, onAnswer, onGuess }: any) {
  const currentQuestion = questionCategories[gameState.category as keyof typeof questionCategories][parseInt(gameState.questionIds[gameState.currentQuestionIndex])];
  const me = gameState.players.find((p: any) => p.id === myId);

  if (gameState.status === 'answering') {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
        <div className="bg-white/5 p-4 rounded-2xl mb-8 flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-white/40">
          <span>السؤال {gameState.currentQuestionIndex + 1} / {gameState.questionIds.length}</span>
          <span className="bg-indigo-600 text-white px-3 py-1 rounded-full">{gameState.category}</span>
        </div>

        <div className="bg-white text-indigo-950 p-10 rounded-[3rem] shadow-2xl relative mb-10 overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-100 rounded-full -mr-16 -mt-16 opacity-50"></div>
           <p className="text-3xl font-black text-right leading-tight relative z-10">{currentQuestion}</p>
           <div className="absolute bottom-4 left-6 text-indigo-300 font-black italic">؟</div>
        </div>

        {me?.isReady ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6">
            <div className="relative">
              <div className="w-24 h-24 border-8 border-indigo-500/20 rounded-full"></div>
              <div className="absolute inset-0 w-24 h-24 border-8 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <div>
               <h2 className="text-3xl font-black mb-2">تم الإرسال!</h2>
               <p className="text-indigo-300 font-bold">باقي أهلك يخلصون...</p>
            </div>
            <div className="flex gap-3">
               {gameState.players.map((p: any) => (
                 <div key={p.id} className={`w-3 h-3 rounded-full transition-all duration-500 ${p.isReady ? 'bg-indigo-400 scale-125' : 'bg-white/10'}`}></div>
               ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <textarea 
              autoFocus
              className="flex-1 bg-white/5 border-2 border-white/5 rounded-[2.5rem] p-8 text-2xl outline-none focus:border-indigo-500 text-white resize-none mb-8 text-right font-bold transition-all"
              placeholder="اكتب إجابتك هنا بصدق..."
            />
            <button 
              onClick={() => {
                const val = (document.querySelector('textarea') as HTMLTextAreaElement).value;
                if (val.trim()) onAnswer(val);
              }}
              className="bg-white text-indigo-950 py-6 rounded-[2rem] font-black text-2xl shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all"
            >
              <Send size={28} /> إرسال الإجابة
            </button>
          </div>
        )}
      </motion.div>
    );
  }

  if (gameState.status === 'guessing') {
    const targetPlayer = gameState.players.find((p: any) => p.id === gameState.targetPlayerId);
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col">
        <div className="text-center mb-10">
          <p className="text-indigo-400 font-black text-sm mb-4 uppercase tracking-[0.3em]">تخمين المجهول</p>
          <div className="bg-white text-indigo-950 p-10 rounded-[3rem] shadow-2xl italic font-black text-3xl border-b-8 border-indigo-100">
            "{targetPlayer.lastAnswer}"
          </div>
        </div>

        <h3 className="text-2xl font-black text-center mb-8">من تتوقع قال كذا؟</h3>

        <div className="grid grid-cols-2 gap-4 overflow-y-auto pb-10 flex-1">
           {gameState.players.map((p: any) => (
             <button 
               key={p.id}
               disabled={me?.isReady}
               onClick={() => onGuess(p.id)}
               className={`p-6 rounded-[2.5rem] border-2 transition-all flex flex-col items-center gap-4 relative ${
                 me?.isReady ? 'bg-white/5 opacity-30 grayscale cursor-default' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-indigo-500 active:scale-95'
               }`}
             >
               <span className="text-5xl">{p.avatar}</span>
               <span className="font-black text-lg truncate w-full text-center">{p.name}</span>
             </button>
           ))}
        </div>

        {me?.isReady && (
           <div className="bg-indigo-600 p-5 rounded-[2rem] text-center font-black text-xl shadow-xl animate-pulse">
              تم التخمين.. نشوف البقية!
           </div>
        )}
      </motion.div>
    );
  }

  if (gameState.status === 'revealing') {
    const targetPlayer = gameState.players.find((p: any) => p.id === gameState.targetPlayerId);
    return (
      <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
        <motion.div 
          animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.2, 1] }} 
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-[10rem] drop-shadow-2xl"
        >
          {targetPlayer.avatar}
        </motion.div>
        <div>
          <h2 className="text-6xl font-black mb-4">إنه {targetPlayer.name}!</h2>
          <div className="inline-block bg-green-500 text-white px-8 py-3 rounded-full font-black text-2xl shadow-2xl">
            كفـووو! 🔥
          </div>
        </div>
        <div className="bg-white/5 p-10 rounded-full border border-white/10">
           <Eye size={64} className="text-indigo-400" />
        </div>
      </motion.div>
    );
  }

  if (gameState.status === 'results') {
    const sorted = [...gameState.players].sort((a, b) => b.score - a.score);
    return (
      <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex-1 flex flex-col items-center">
        <div className="relative mb-8 mt-4">
           <Trophy size={100} className="text-yellow-400 drop-shadow-[0_0_30px_rgba(250,204,21,0.5)]" />
           <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 10, ease: "linear" }} className="absolute -inset-4 border-4 border-dashed border-yellow-400/20 rounded-full"></motion.div>
        </div>
        
        <h2 className="text-5xl font-black mb-10 tracking-tighter">ملك التخمين!</h2>
        
        <div className="w-full space-y-4 flex-1 overflow-y-auto mb-10 px-2 custom-scrollbar">
           {sorted.map((p, i) => (
             <motion.div 
                initial={{ x: -50, opacity: 0 }} 
                animate={{ x: 0, opacity: 1 }} 
                transition={{ delay: i * 0.1 }}
                key={p.id} 
                className={`flex items-center gap-6 p-6 rounded-[2.5rem] border-2 transition-all ${
                  i === 0 
                  ? 'bg-yellow-400 text-indigo-950 border-yellow-300 scale-105 shadow-[0_20px_40px_rgba(250,204,21,0.3)]' 
                  : 'bg-white/5 border-white/5'
                }`}
             >
                <span className="text-3xl font-black opacity-40">#{i+1}</span>
                <span className="text-5xl">{p.avatar}</span>
                <div className="flex-1">
                   <p className="font-black text-2xl">{p.name}</p>
                   <p className={`text-sm font-bold ${i === 0 ? 'text-indigo-800' : 'text-indigo-400'}`}>{p.score} نقطة</p>
                </div>
                {i === 0 && <Award size={40} />}
             </motion.div>
           ))}
        </div>

        <button 
          onClick={() => window.location.reload()}
          className="w-full bg-white text-indigo-950 py-6 rounded-[2rem] font-black text-2xl shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all"
        >
          <RotateCcw size={28} /> العودة للقائمة
        </button>
      </motion.div>
    );
  }

  return null;
}
