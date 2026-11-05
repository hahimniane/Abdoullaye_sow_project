import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/box_3d_page.dart';
import 'package:my_flutter_app/widgets/box_designer/box_geometry.dart';

void main() {
  group('box3dPageUri', () {
    test('puts inches and language in the query', () {
      final uri = box3dPageUri(dims: const BoxDims(24, 18.5, 18), lang: 'fr');
      expect(uri.origin, 'https://customer.laawoldigital.com');
      expect(uri.path, '/box-3d/');
      expect(uri.queryParameters, {
        'l': '24',
        'w': '18.5',
        'h': '18',
        'lang': 'fr',
      });
    });

    test('any language but French is English; sides are clamped', () {
      final uri = box3dPageUri(dims: const BoxDims(0, 500, 12.04), lang: 'es');
      expect(uri.queryParameters, {
        'l': '1',
        'w': '120',
        'h': '12',
        'lang': 'en',
      });
    });

    test('a test base replaces the constant', () {
      final uri = box3dPageUri(
        dims: BoxDims.start,
        lang: 'en',
        base: 'http://localhost:3000/box-3d/',
      );
      expect(uri.toString(), startsWith('http://localhost:3000/box-3d/?'));
    });
  });

  group('isBox3dNavigationAllowed', () {
    test('only the page itself loads', () {
      final own = box3dPageUri(dims: BoxDims.start, lang: 'en').toString();
      expect(isBox3dNavigationAllowed(own), isTrue);
      expect(isBox3dNavigationAllowed(box3dPageUrl), isTrue);
      expect(isBox3dNavigationAllowed('about:blank'), isTrue);
      expect(
        isBox3dNavigationAllowed('https://customer.laawoldigital.com/box-3d'),
        isTrue,
      );
    });

    test('everything else is refused', () {
      for (final url in [
        'https://evil.example/box-3d/',
        'https://customer.laawoldigital.com/',
        'https://customer.laawoldigital.com/box-3d/../login',
        'http://customer.laawoldigital.com/box-3d/',
        'https://customer.laawoldigital.com:8443/box-3d/',
        'javascript:alert(1)',
        'intent://x',
        '',
      ]) {
        expect(isBox3dNavigationAllowed(url), isFalse, reason: url);
      }
    });
  });

  group('scripts', () {
    test('setDims and setLang are guarded calls', () {
      expect(
        box3dSetDimsScript(const BoxDims(20, 16.5, 14)),
        'window.laawolBox3d&&window.laawolBox3d.setDims('
        '{l:20,w:16.5,h:14});',
      );
      expect(
        box3dSetLangScript('fr'),
        'window.laawolBox3d&&window.laawolBox3d.setLang("fr");',
      );
      expect(box3dSetLangScript('de'), contains('"en"'));
    });
  });

  group('Box3dSceneState phases', () {
    Box3dSceneState fresh() => Box3dSceneState(dims: BoxDims.start, lang: 'en');

    test('starts loading', () {
      expect(fresh().phase, Box3dPhase.loading);
    });

    test('"ready" shows the page', () {
      final s = fresh();
      expect(s.onChannelMessage('ready'), isTrue);
      expect(s.isReady, isTrue);
    });

    test('"failed", a page error and the timeout each keep the painter', () {
      final failed = fresh()..onChannelMessage('failed');
      expect(failed.isFallback, isTrue);
      final errored = fresh()..onPageError();
      expect(errored.isFallback, isTrue);
      final slow = fresh()..onTimeout();
      expect(slow.isFallback, isTrue);
    });

    test('both outcomes are final', () {
      final fell = fresh()..onTimeout();
      expect(fell.onChannelMessage('ready'), isFalse);
      expect(fell.isFallback, isTrue);
      final up = fresh()..onChannelMessage('ready');
      expect(up.onChannelMessage('failed'), isFalse);
      expect(up.onTimeout(), isFalse);
      expect(up.onPageError(), isFalse);
      expect(up.isReady, isTrue);
    });

    test('unknown messages change nothing', () {
      final s = fresh();
      expect(s.onChannelMessage('hello'), isFalse);
      expect(s.onChannelMessage(' ready\n'), isTrue);
    });
  });

  group('Box3dSceneState throttle', () {
    Box3dSceneState ready() =>
        Box3dSceneState(dims: BoxDims.start, lang: 'en')
          ..onChannelMessage('ready');

    test('many changes in a frame make one flush with the last inches', () {
      final s = ready();
      expect(s.requestDims(const BoxDims(15, 10, 8)), isTrue);
      expect(s.requestDims(const BoxDims(16, 10, 8)), isFalse);
      expect(s.requestDims(const BoxDims(17, 10, 8)), isFalse);
      expect(s.takeScripts(), [box3dSetDimsScript(const BoxDims(17, 10, 8))]);
      // The next change schedules again.
      expect(s.requestDims(const BoxDims(18, 10, 8)), isTrue);
    });

    test('nothing is sent when nothing differs from the page', () {
      final s = ready();
      s.requestDims(BoxDims.start);
      expect(s.takeScripts(), isEmpty);
      s.requestDims(const BoxDims(20, 10, 8));
      s.requestDims(BoxDims.start);
      expect(s.takeScripts(), isEmpty);
    });

    test('the language is sent on change only', () {
      final s = ready();
      s.requestLang('en');
      expect(s.takeScripts(), isEmpty);
      s.requestLang('fr');
      expect(s.takeScripts(), [box3dSetLangScript('fr')]);
      s.requestLang('fr');
      expect(s.takeScripts(), isEmpty);
    });

    test('dims and language together are two scripts in one flush', () {
      final s = ready();
      s.requestDims(const BoxDims(30, 20, 20));
      s.requestLang('fr');
      expect(s.takeScripts(), hasLength(2));
    });

    test('nothing goes before ready; ready catches up in one flush', () {
      final s = Box3dSceneState(dims: BoxDims.start, lang: 'en');
      expect(s.requestDims(const BoxDims(30, 20, 20)), isTrue);
      expect(s.takeScripts(), isEmpty);
      s.requestDims(const BoxDims(31, 20, 20));
      s.onChannelMessage('ready');
      // A flush is already waiting for the next frame.
      expect(s.requestCatchUp(), isFalse);
      expect(s.takeScripts(), [box3dSetDimsScript(const BoxDims(31, 20, 20))]);
    });

    test('nothing goes after a fallback', () {
      final s = Box3dSceneState(dims: BoxDims.start, lang: 'en')
        ..onChannelMessage('failed');
      s.requestDims(const BoxDims(30, 20, 20));
      expect(s.takeScripts(), isEmpty);
    });
  });
}
