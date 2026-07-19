import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/support_attachment_policy.dart';

void main() {
  test('support attachments use the same per-type limits as the backend', () {
    expect(supportAttachmentMaxBytes('image'), supportImageMaxBytes);
    expect(supportAttachmentMaxBytes('video'), supportVideoMaxBytes);
    expect(supportAttachmentMaxBytes('file'), supportDocumentMaxBytes);
    expect(supportAttachmentMaxBytes('voice'), supportVoiceMaxBytes);
  });

  test('support attachment limits reject the exact server boundary', () {
    expect(
      supportAttachmentExceedsLimit(
        messageType: 'image',
        byteLength: supportImageMaxBytes - 1,
      ),
      isFalse,
    );
    expect(
      supportAttachmentExceedsLimit(
        messageType: 'image',
        byteLength: supportImageMaxBytes,
      ),
      isTrue,
    );
    expect(
      supportAttachmentExceedsLimit(
        messageType: 'video',
        byteLength: supportVideoMaxBytes,
      ),
      isTrue,
    );
    expect(
      supportAttachmentExceedsLimit(
        messageType: 'file',
        byteLength: supportDocumentMaxBytes,
      ),
      isTrue,
    );
  });
}
