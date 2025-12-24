import { GamePayload, GameMessage } from "@/types/games";
import { TwoTruthsGame } from "./games/TwoTruthsGame";
import { WouldRatherGame } from "./games/WouldRatherGame";
import { CharadesGame } from "./games/CharadesGame";
import { ScavengerGame } from "./games/ScavengerGame";
import { RouletteGame } from "./games/RouletteGame";
import { IntuitionGame } from "./games/IntuitionGame";
import { cn } from "@/lib/utils";

interface GameBubbleRendererProps {
  message: GameMessage;
  matchName?: string;
  onGameUpdate?: (messageId: string, updatedPayload: GamePayload) => void;
}

export const GameBubbleRenderer = ({ message, matchName = "Match", onGameUpdate }: GameBubbleRendererProps) => {
  const isOwn = message.sender === "me";
  const payload = message.gamePayload;

  if (!payload) return null;

  const handleUpdate = (updates: Partial<GamePayload['data']>) => {
    if (!payload) return;
    
    const updatedPayload = {
      ...payload,
      step: 'completed' as const,
      data: {
        ...payload.data,
        ...updates,
      }
    } as GamePayload;
    
    onGameUpdate?.(message.id, updatedPayload);
  };

  const renderGame = () => {
    switch (payload.gameType) {
      case '2truths':
        return (
          <TwoTruthsGame
            payload={payload}
            isOwn={isOwn}
            onGuess={(index) => handleUpdate({ guessedIndex: index, isCorrect: index === payload.data.lieIndex })}
          />
        );
      
      case 'would_rather':
        return (
          <WouldRatherGame
            payload={payload}
            isOwn={isOwn}
            onVote={(choice) => handleUpdate({ receiverVote: choice, isMatch: payload.data.senderVote === choice })}
          />
        );
      
      case 'charades':
        return (
          <CharadesGame
            payload={payload}
            isOwn={isOwn}
            onGuess={(guess) => handleUpdate({ guesses: [...(payload.data.guesses || []), guess] })}
          />
        );
      
      case 'scavenger':
        return (
          <ScavengerGame
            payload={payload}
            isOwn={isOwn}
            onUploadPhoto={(url) => handleUpdate({ receiverPhotoUrl: url, isUnlocked: true })}
          />
        );
      
      case 'roulette':
        return (
          <RouletteGame
            payload={payload}
            isOwn={isOwn}
            onAnswer={(answer) => handleUpdate({ receiverAnswer: answer, isUnlocked: true })}
          />
        );
      
      case 'intuition':
        return (
          <IntuitionGame
            payload={payload}
            isOwn={isOwn}
            matchName={matchName}
            onRespond={(response) => handleUpdate({ receiverResponse: response })}
          />
        );
      
      default:
        return null;
    }
  };

  return (
    <div className={cn(
      "flex",
      isOwn ? "justify-end" : "justify-start"
    )}>
      {renderGame()}
    </div>
  );
};
