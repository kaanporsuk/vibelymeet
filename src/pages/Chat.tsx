import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Send, MoreVertical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMessages, useSendMessage } from "@/hooks/useMessages";

const Chat = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { data, isLoading } = useMessages(id || "");
  const sendMessage = useSendMessage();
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [data?.messages]);

  const handleSend = () => {
    if (!newMessage.trim() || !data?.matchId) return;

    sendMessage.mutate({
      matchId: data.matchId,
      content: newMessage,
    });
    setNewMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const otherUser = data?.otherUser || { name: "Unknown", age: 0, avatar_url: null };
  const messages = data?.messages || [];

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
                src={otherUser.avatar_url || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400"}
                alt={otherUser.name}
                className="w-10 h-10 rounded-full object-cover"
              />
              <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-background" />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">
                {otherUser.name}, {otherUser.age}
              </h2>
              <p className="text-xs text-muted-foreground">Online now</p>
            </div>
          </div>

          <button className="p-2 rounded-xl hover:bg-secondary transition-colors">
            <MoreVertical className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <span className="text-3xl">👋</span>
            </div>
            <p className="text-muted-foreground">Start a conversation!</p>
          </div>
        ) : (
          messages.map((message) => (
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
          ))
        )}
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
            disabled={!newMessage.trim() || sendMessage.isPending}
            variant="gradient"
            size="icon"
            className="h-12 w-12 rounded-2xl"
          >
            {sendMessage.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Chat;
