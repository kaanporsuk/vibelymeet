import { cn } from "@/lib/utils";
import type { ConversationPreview } from "../../shared/chat/conversationListPreview";

type Props = {
  preview: ConversationPreview;
  /** Stronger preview color when the row is unread (plain text only). */
  unread: boolean;
  className?: string;
};

export function ConversationListPreviewLabel({ preview, unread, className }: Props) {
  const textClass = cn(
    preview.presentation === "plain" &&
      (unread ? "text-foreground font-medium" : "text-muted-foreground"),
    preview.presentation === "label" && "italic text-muted-foreground",
    preview.presentation === "empty_state" && "italic text-primary",
  );

  if (preview.prefix === "You") {
    return (
      <span className={cn("truncate", className)}>
        <span className="text-muted-foreground not-italic">You: </span>
        <span className={textClass}>{preview.text}</span>
      </span>
    );
  }

  return (
    <span className={cn("truncate", textClass, className)}>
      {preview.text}
    </span>
  );
}
