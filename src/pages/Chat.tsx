import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const mockUser = {
  id: "1",
  name: "Emma",
  age: 26,
  image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400",
  online: true,
};

const initialMessages = [
  {
    id: "1",
    text: "Hey! It was so nice meeting you at the 90s night event! 🎶",
    sender: "them",
    time: "8:30 PM",
  },
  {
    id: "2",
    text: "Same here! I loved your music taste, you really know your 90s hits!",
    sender: "me",
    time: "8:32 PM",
  },
  {
    id: "3",
    text: "Haha thanks! The Backstreet Boys will always be my guilty pleasure 😅",
    sender: "them",
    time: "8:33 PM",
  },
  {
    id: "4",
    text: "No judgment here! I was singing along to every song",
    sender: "me",
    time: "8:35 PM",
  },
  {
    id: "5",
    text: "Would you want to grab coffee sometime this week?",
    sender: "them",
    time: "8:40 PM",
  },
];

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [messages, setMessages] = useState(initialMessages);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!newMessage.trim()) return;

    const message = {
      id: Date.now().toString(),
      text: newMessage,
      sender: "me",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages([...messages, message]);
    setNewMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 glass-card border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/matches")}
            className="p-2 -ml-2 rounded-xl hover:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>

          <div className="flex items-center gap-3 flex-1">
            <div className="relative">
              <img
                src={mockUser.image}
                alt={mockUser.name}
                className="w-10 h-10 rounded-full object-cover"
              />
              {mockUser.online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
              )}
            </div>
            <div>
              <h2 className="font-semibold text-foreground">
                {mockUser.name}, {mockUser.age}
              </h2>
              <p className="text-xs text-muted-foreground">
                {mockUser.online ? "Online now" : "Offline"}
              </p>
            </div>
          </div>

          <button className="p-2 rounded-xl hover:bg-secondary transition-colors">
            <MoreVertical className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === "me" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                message.sender === "me"
                  ? "bg-gradient-primary text-white rounded-br-md"
                  : "glass-card text-foreground rounded-bl-md"
              }`}
            >
              <p className="text-sm">{message.text}</p>
              <p
                className={`text-[10px] mt-1 ${
                  message.sender === "me" ? "text-white/70" : "text-muted-foreground"
                }`}
              >
                {message.time}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Input */}
      <div className="sticky bottom-0 glass-card border-t border-white/10 p-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <Input
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            className="flex-1 h-12 rounded-2xl glass-card border-white/10"
          />
          <Button
            onClick={handleSend}
            disabled={!newMessage.trim()}
            variant="gradient"
            size="icon"
            className="h-12 w-12 rounded-2xl"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
