import { useEffect } from 'react';
import { Rocket } from 'lucide-react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';

interface VibeSentSuccessProps {
  matchName: string;
  onContinue: () => void;
}

export function VibeSentSuccess({ matchName, onContinue }: VibeSentSuccessProps) {
  useEffect(() => {
    // Trigger confetti
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8B5CF6', '#EC4899', '#06B6D4']
    });
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex items-center justify-center p-6"
    >
      <div className="text-center space-y-6 max-w-sm">
        <motion.div
          animate={{ 
            y: [0, -20, 0],
            rotate: [0, 10, -10, 0]
          }}
          transition={{ 
            duration: 1.5,
            repeat: Infinity,
            repeatType: 'reverse'
          }}
          className="text-7xl"
        >
          <Rocket className="w-20 h-20 mx-auto text-primary" />
        </motion.div>

        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-3xl font-display font-bold gradient-text"
          >
            Vibe Sent! 🚀
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground mt-2"
          >
            Your video reply is on its way to {matchName}.
            <br />
            We'll notify you when they respond!
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Button variant="gradient" size="lg" onClick={onContinue}>
            Back to Dashboard
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
