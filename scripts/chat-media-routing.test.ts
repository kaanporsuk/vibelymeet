import assert from "node:assert/strict";
import {
  extractChatImageIdentityRef,
  extractChatImageMediaRef,
  extractRenderableChatImageUrl,
  formatChatImageMessageContent,
  inferChatMediaRenderKind,
  isRenderableChatImageUrl,
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

const privatePhotoRef = "photos/thread/photo.jpg";
const privatePhotoRow = {
  content: formatChatImageMessageContent(privatePhotoRef),
  structured_payload: {
    v: 2,
    kind: "chat_image",
    provider: "bunny_storage",
    media_ref: privatePhotoRef,
  },
};
assert.equal(extractChatImageMediaRef(privatePhotoRow), null);
assert.equal(extractChatImageMediaRef(privatePhotoRow, { allowPrivateMediaRefs: true }), privatePhotoRef);
assert.equal(extractChatImageIdentityRef(privatePhotoRow), privatePhotoRef);
assert.equal(extractRenderableChatImageUrl(privatePhotoRow), null);
assert.equal(isRenderableChatImageUrl(privatePhotoRef), false);
assert.equal(isRenderableChatImageUrl(remotePhoto), true);
assert.equal(isRenderableChatImageUrl(localFile), true);
assert.equal(inferChatMediaRenderKind(privatePhotoRow), "image");

console.log("chat-media-routing tests passed");
