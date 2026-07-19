enum SupportAttachmentKind { image, video, file, voice }

const supportImageMaxBytes = 10 * 1024 * 1024;
const supportVideoMaxBytes = 50 * 1024 * 1024;
const supportDocumentMaxBytes = 25 * 1024 * 1024;
const supportVoiceMaxBytes = 10 * 1024 * 1024;

SupportAttachmentKind supportAttachmentKind(String messageType) {
  return switch (messageType) {
    'image' => SupportAttachmentKind.image,
    'video' => SupportAttachmentKind.video,
    'voice' => SupportAttachmentKind.voice,
    _ => SupportAttachmentKind.file,
  };
}

int supportAttachmentMaxBytes(String messageType) {
  return switch (supportAttachmentKind(messageType)) {
    SupportAttachmentKind.image => supportImageMaxBytes,
    SupportAttachmentKind.video => supportVideoMaxBytes,
    SupportAttachmentKind.file => supportDocumentMaxBytes,
    SupportAttachmentKind.voice => supportVoiceMaxBytes,
  };
}

bool supportAttachmentExceedsLimit({
  required String messageType,
  required int byteLength,
}) {
  return byteLength >= supportAttachmentMaxBytes(messageType);
}
