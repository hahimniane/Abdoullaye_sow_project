import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';

List<int> _a(String text) => ascii.encode(text);

void main() {
  group('the picture', () {
    test('packs rows MSB-first: the leftmost dot is bit 7', () {
      final image = LabelBitmap(8, 1)..set(0, 0);
      final packed = pm241PackBitmap(image);
      // Dot 0 black = bit 7 cleared; the other seven are white.
      expect(packed.data, [0x7F]);
      final right = LabelBitmap(8, 1)..set(7, 0);
      expect(pm241PackBitmap(right).data, [0xFE]);
    });

    test('0 is black and 1 is white (a blank picture is all 0xFF)', () {
      final blank = pm241PackBitmap(LabelBitmap(16, 2));
      expect(blank.data, List.filled(4, 0xFF));
      final full = LabelBitmap(16, 1)..fill(0, 0, 15, 0);
      expect(pm241PackBitmap(full).data, [0x00, 0x00]);
    });

    test('a width that is not a multiple of 8 is padded with white', () {
      final image = LabelBitmap(10, 1)..fill(0, 0, 9, 0);
      final packed = pm241PackBitmap(image);
      expect(packed.widthBytes, 2);
      // 8 black dots, then 2 black and 6 padding dots that stay white.
      expect(packed.data, [0x00, 0x3F]);
    });

    test('the 4 x 6 picture is 100 bytes by 1180 rows', () {
      final packed = pm241PackBitmap(
        LabelBitmap(pm241LabelWidthDots, pm241LabelHeightDots),
      );
      expect(packed.widthBytes, 100);
      expect(packed.rows, 1180);
      expect(packed.data.length, 118000);
    });

    test('pm241Fits keeps pictures on the label', () {
      expect(pm241Fits(LabelBitmap(800, 1180)), isTrue);
      expect(pm241Fits(LabelBitmap(406, 203)), isTrue);
      expect(pm241Fits(LabelBitmap(801, 1180)), isFalse);
      expect(pm241Fits(LabelBitmap(800, 1181)), isFalse);
    });
  });

  group('the job', () {
    test('header and footer are the proven TSPL bytes', () {
      final image = LabelBitmap(16, 2)..set(0, 0);
      final job = pm241LabelJob(image);
      expect(
        utf8.decode(job.header),
        'SIZE 100 mm, 150 mm\r\n'
        'GAP 3 mm, 0 mm\r\n'
        'DENSITY 10\r\n'
        'SPEED 4\r\n'
        'DIRECTION 0\r\n'
        'CLS\r\n'
        'BITMAP 6,10,2,2,0,',
      );
      expect(job.bitmap, [0x7F, 0xFF, 0xFF, 0xFF]);
      expect(utf8.decode(job.footer), '\r\nPRINT 1\r\n');
      expect(job.bytes, [...job.header, ...job.bitmap, ...job.footer]);
      expect(job.length, job.bytes.length);
    });

    test('never sends END and never rotates with DIRECTION 1', () {
      final text = utf8.decode(
        pm241LabelJob(LabelBitmap(8, 1)).bytes,
        allowMalformed: true,
      );
      expect(text, isNot(contains('END')));
      expect(text, isNot(contains('DIRECTION 1')));
      expect(text, contains('DIRECTION 0'));
    });

    test('the full label job names 100 bytes by 1180 rows', () {
      final job = pm241LabelJob(LabelBitmap(800, 1180));
      expect(utf8.decode(job.header), endsWith('BITMAP 6,10,100,1180,0,'));
    });

    test('the test label has a border and a QR in the middle', () {
      final qr = tagQrMatrix(inventoryTagLink('IT-TEST00'));
      final image = pm241TestLabel(qr);
      expect(image.width, 800);
      expect(image.height, 1180);
      for (final (x, y) in [(0, 0), (799, 0), (0, 1179), (799, 1179)]) {
        expect(image.black(x, y), isTrue, reason: '$x,$y');
      }
      expect(image.black(400, 3), isTrue);
      expect(image.blackCount, greaterThan(20000));
    });
  });

  group('replies and flow control', () {
    test('01 n adds credits, 02 lo hi sets the packet size', () {
      final flow = Pm241Flow();
      expect(flow.credits, 0);
      expect(flow.maxPacket, isNull);
      final events = flow.feed([0x01, 0x07]);
      expect(events.single.type, Pm241EventType.credit);
      expect(events.single.value, 7);
      expect(flow.credits, 7);
      flow.feed([0x02, 0xF4, 0x00]);
      expect(flow.maxPacket, 244);
      flow.feed([0x01, 0x01]);
      expect(flow.credits, 8);
    });

    test('a packet size above 255 reads both bytes', () {
      final flow = Pm241Flow()..feed([0x02, 0x00, 0x01]);
      expect(flow.maxPacket, 256);
    });

    test('the packet size is the smaller of the printer and the link', () {
      final flow = Pm241Flow();
      // Until the printer speaks: the conservative 20 bytes.
      expect(flow.packetSize(512), 20);
      flow.feed([0x02, 0xF4, 0x00]);
      expect(flow.packetSize(512), 244);
      expect(flow.packetSize(182), 182);
      expect(flow.packetSize(0), 244);
      expect(Pm241Flow().packetSize(1), 1);
    });

    test('text replies: DOING, DONE and Cmd error', () {
      final flow = Pm241Flow();
      expect(
        flow.feed(_a('SSSGETPRINTING:DOING\r\n')).single.type,
        Pm241EventType.printing,
      );
      expect(
        flow.feed(_a('SSSGETPRINTING:DONE\r\n')).single.type,
        Pm241EventType.done,
      );
      final error = flow.feed(_a('Cmd error:END\r\n')).single;
      expect(error.type, Pm241EventType.cmdError);
      expect(error.text, 'END');
      expect(error.logLine, 'reply: Cmd error:END');
      final other = flow.feed(_a('hello\r\n')).single;
      expect(other.type, Pm241EventType.text);
      expect(other.text, 'hello');
    });

    test('a line cut across two notifications is completed by the next', () {
      final flow = Pm241Flow();
      expect(flow.feed(_a('SSSGETPRINT')), isEmpty);
      expect(flow.feed(_a('ING:DONE')), isEmpty);
      expect(flow.feed(_a('\r\n')).single.type, Pm241EventType.done);
    });

    test('flow frames and text in one notification are all read', () {
      final flow = Pm241Flow();
      final events = flow.feed([
        0x01,
        0x02,
        ..._a('SSSGETPRINTING:DOING\r\n'),
        0x01,
        0x01,
      ]);
      expect(events.map((e) => e.type), [
        Pm241EventType.credit,
        Pm241EventType.printing,
        Pm241EventType.credit,
      ]);
      expect(flow.credits, 3);
    });

    test('blank lines are ignored and junk never throws', () {
      final flow = Pm241Flow();
      expect(flow.feed(_a('\r\n')), isEmpty);
      expect(flow.feed([0xFF, 0xFE, 0x0A]).single.type, Pm241EventType.text);
      expect(flow.feed(const []), isEmpty);
      // A lone credit marker with no count is held as text, not a crash.
      flow.feed([0x01]);
    });

    test('log lines name what the printer said', () {
      expect(
        const Pm241Event(Pm241EventType.done).logLine,
        'reply: SSSGETPRINTING:DONE',
      );
      expect(
        const Pm241Event(Pm241EventType.maxPacket, value: 244).logLine,
        'flow: max packet 244 bytes',
      );
    });
  });

  group('sending by credits', () {
    final bytes = List<int>.generate(100, (i) => i);

    test('one packet per credit, never more than the credits', () {
      final flow = Pm241Flow()
        ..feed([0x01, 0x03])
        ..feed([0x02, 30, 0]);
      final sender = Pm241Sender(bytes, flow);
      final packets = <List<int>>[];
      for (var p = sender.next(182); p != null; p = sender.next(182)) {
        packets.add(p);
      }
      // 3 credits: 3 packets of 30 bytes, then it must wait.
      expect(packets.map((p) => p.length), [30, 30, 30]);
      expect(sender.finished, isFalse);
      expect(flow.credits, 0);
      expect(sender.next(182), isNull);
      expect(sender.sent, 90);
    });

    test('01 01 releases exactly one more packet; the last one is short', () {
      final flow = Pm241Flow()
        ..feed([0x01, 0x03])
        ..feed([0x02, 30, 0]);
      final sender = Pm241Sender(bytes, flow);
      final out = <int>[];
      while (true) {
        final p = sender.next(182);
        if (p == null) break;
        out.addAll(p);
      }
      flow.feed([0x01, 0x01]);
      final last = sender.next(182)!;
      expect(last.length, 10);
      out.addAll(last);
      expect(sender.finished, isTrue);
      expect(sender.next(182), isNull);
      expect(out, bytes);
      expect(sender.packets, 4);
    });

    test('the link payload caps the packet', () {
      final flow = Pm241Flow()
        ..feed([0x01, 0x07])
        ..feed([0x02, 0xF4, 0x00]);
      final sender = Pm241Sender(bytes, flow);
      expect(sender.next(40)!.length, 40);
    });

    test('a whole label job splits losslessly', () {
      final job = pm241LabelJob(LabelBitmap(800, 1180)..fill(10, 10, 300, 40));
      final flow = Pm241Flow()
        ..feed([0x01, 0x07])
        ..feed([0x02, 0xF4, 0x00]);
      final sender = Pm241Sender(job.bytes, flow);
      final out = <int>[];
      var packets = 0;
      while (!sender.finished) {
        final p = sender.next(244);
        if (p == null) {
          flow.feed([0x01, 0x01]);
          continue;
        }
        expect(p.length, lessThanOrEqualTo(244));
        out.addAll(p);
        packets++;
        flow.feed([0x01, 0x01]);
      }
      expect(out, job.bytes);
      expect(packets, (job.length / 244).ceil());
    });
  });
}
