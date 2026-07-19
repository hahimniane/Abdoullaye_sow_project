import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/support_message.dart';

void main() {
  group('SupportMessage', () {
    test('parses file attachment metadata helpers', () {
      final message = SupportMessage.fromMap('message-1', {
        'senderId': 'user-1',
        'senderRole': 'customer',
        'senderName': 'Customer',
        'content': '',
        'messageType': 'file',
        'metadata': {
          'fileUrl': 'https://example.com/receipt.pdf',
          'fileName': 'receipt.pdf',
          'fileSize': '2048',
        },
      });

      expect(message.isAttachment, isTrue);
      expect(message.fileUrl, 'https://example.com/receipt.pdf');
      expect(message.fileName, 'receipt.pdf');
      expect(message.fileSize, 2048);
    });

    test('parses voice attachment duration metadata', () {
      final message = SupportMessage.fromMap('message-2', {
        'senderId': 'user-1',
        'senderRole': 'customer',
        'senderName': 'Customer',
        'content': '',
        'messageType': 'voice',
        'metadata': {
          'file_url': 'https://example.com/voice.mp3',
          'duration_seconds': 73,
        },
      });

      expect(message.isAttachment, isTrue);
      expect(message.fileUrl, 'https://example.com/voice.mp3');
      expect(message.durationSeconds, 73);
    });
  });
}
