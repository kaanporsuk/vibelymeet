export {
  CHAT_IMAGE_MESSAGE_PREFIX,
  extractChatImageIdentityRef,
  extractChatImageMediaRef,
  extractRenderableChatImageUrl,
  parseChatImageMessageContent,
  parseChatImageStructuredPayload,
  formatChatImageMessageContent,
  isRenderableChatImageUrl,
  inferChatMediaRenderKind,
} from "../../shared/chat/messageRouting";
export type { ChatImagePayload, ParseChatImageMessageOptions } from "../../shared/chat/messageRouting";
