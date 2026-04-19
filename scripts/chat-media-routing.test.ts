import assert from "node:assert/strict";
import {
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  parseChatImageMessageContent,
} from "../shared/chat/messageRouting";

const remotePhoto = "https://cdn.example.com/photos/user/photo.jpg?quality=88";
assert.equal(parseChatImageMessageContent(formatChatImageMessageContent(remotePhoto)), remotePhoto);
assert.equal(inferChatMediaRenderKind({ content: formatChatImageMessageContent(remotePhoto) }), "image");

const localBlob = "blob:https://vibelymeet.test/preview";
assert.equal(parseChatImageMessageContent(formatChatImageMessageContent(localBlob)), null);
assert.equal(
  parseChatImageMessageContent(formatChatImageMessageContent(localBlob), { allowLocalPreviewUrls: true }),
  localBlob,
);

const localFile = "file:///var/mobile/Containers/Data/chat-photo.jpg";
assert.equal(
  parseChatImageMessageContent(formatChatImageMessageContent(localFile), { allowLocalPreviewUrls: true }),
  localFile,
);

const dataImage = "data:image/png;base64,iVBORw0KGgo=";
assert.equal(
  parseChatImageMessageContent(formatChatImageMessageContent(dataImage), { allowLocalPreviewUrls: true }),
  dataImage,
);

assert.equal(
  parseChatImageMessageContent(formatChatImageMessageContent("data:text/plain,hello"), {
    allowLocalPreviewUrls: true,
  }),
  null,
);

console.log("chat-media-routing tests passed");
