import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/box_sizes.dart';
import 'package:my_flutter_app/widgets/box_designer/box_geometry.dart';

/// The box designer's pure geometry: inches in, a scene and its projection
/// out - no widget involved.
void main() {
  group('inches', () {
    test('parseInches reads 1 to 120, a tenth, a comma or a point', () {
      expect(parseInches('12'), 12);
      expect(parseInches(' 12,5 '), 12.5);
      expect(parseInches('12.46'), 12.5);
      expect(parseInches('120'), 120);
      expect(parseInches('1'), 1);
    });

    test('parseInches refuses what is not inches', () {
      for (final bad in ['', ' ', 'abc', '0', '0.4', '120.1', '121', '-3']) {
        expect(parseInches(bad), isNull, reason: bad);
      }
    });

    test('inchesText drops a trailing .0', () {
      expect(inchesText(12), '12');
      expect(inchesText(12.5), '12.5');
      expect(inchesText(12.04), '12');
    });

    test('BoxDims round-trips the server map and clamps', () {
      const d = BoxDims(20, 16.5, 14);
      expect(BoxDims.fromMap(d.toMap()), d);
      expect(BoxDims.fromMap({'l': 0, 'w': 5, 'h': 5}), isNull);
      expect(BoxDims.fromMap({'l': 5, 'w': 5}), isNull);
      expect(BoxDims.fromMap('x'), isNull);
      expect(const BoxDims(0, 500, 3.04).clamped, const BoxDims(1, 120, 3));
      expect(d.text, '20 × 16.5 × 14 in');
    });
  });

  group('the size follows the inches', () {
    test('through the mirror of the server rule', () {
      expect(boxSizeIdOf(const BoxDims(18, 18, 18)), 'small');
      expect(boxSizeIdOf(const BoxDims(24, 18, 18)), 'medium');
      expect(boxSizeIdOf(const BoxDims(18, 24, 18)), 'medium');
      expect(boxSizeIdOf(const BoxDims(31, 24, 24)), 'large');
      expect(boxSizeIdOf(const BoxDims(31.1, 24, 24)), 'xl');
      expect(boxSizeIdOf(const BoxDims(60, 40, 40)), 'xl');
    });
  });

  group('the view', () {
    test('tilt is clamped and yaw wraps', () {
      expect(clampTilt(-1), boxMinTilt);
      expect(clampTilt(9), boxMaxTilt);
      expect(clampTilt(0.5), 0.5);
      expect(wrapYaw(2 * math.pi + 0.3), closeTo(0.3, 1e-9));
      expect(wrapYaw(-2 * math.pi - 0.3), closeTo(-0.3, 1e-9));
    });

    test('a box has 8 corners standing on the floor', () {
      final v = boxVertices(const BoxDims(20, 10, 6));
      expect(v, hasLength(8));
      expect(v.take(4).every((p) => p.y == 0), isTrue);
      expect(v.skip(4).every((p) => p.y == 6), isTrue);
      expect(v.map((p) => p.x).reduce(math.max), 10);
      expect(v.map((p) => p.z).reduce(math.min), -5);
    });

    test('three faces of the box turn toward the camera, never all six', () {
      final dims = const BoxDims(20, 10, 6);
      final scene = layoutScene(dims);
      final cam = SceneCamera(
        center: scene.center,
        radius: scene.radius,
        yaw: boxDefaultYaw,
        tilt: boxDefaultTilt,
        width: 300,
        height: 240,
      );
      final verts = boxVertices(dims);
      var shown = 0;
      for (final face in boxFaces) {
        var mid = const V3(0, 0, 0);
        for (final c in face.corners) {
          mid = mid + verts[c];
        }
        if (cam.facesCamera(mid.scaled(0.25), face.normal)) shown++;
      }
      expect(shown, 3);
    });

    test('everything fits the canvas at every spin, small or huge box', () {
      const sizes = [
        BoxDims(1, 1, 1),
        BoxDims(14, 10, 8),
        BoxDims(30, 24, 24),
        BoxDims(60, 60, 60),
        BoxDims(120, 120, 120),
        BoxDims(120, 1, 1),
      ];
      for (final dims in sizes) {
        final scene = layoutScene(dims);
        for (var yaw = -3.0; yaw <= 3.0; yaw += 0.5) {
          for (final tilt in [boxMinTilt, 0.4, 0.9, boxMaxTilt]) {
            final cam = SceneCamera(
              center: scene.center,
              radius: scene.radius,
              yaw: yaw,
              tilt: tilt,
              width: 320,
              height: 250,
            );
            for (final p in sceneExtremes(scene, cam)) {
              expect(p.x, inInclusiveRange(0, 320), reason: '$dims $yaw $tilt');
              expect(p.y, inInclusiveRange(0, 250), reason: '$dims $yaw $tilt');
              expect(p.depth, greaterThan(0));
            }
          }
        }
      }
    });

    test('the framing depends on the inches, not on the spin', () {
      final a = layoutScene(const BoxDims(20, 10, 6));
      final b = layoutScene(const BoxDims(20, 10, 6));
      expect(a.radius, b.radius);
      expect(
        layoutScene(const BoxDims(80, 60, 40)).radius,
        greaterThan(layoutScene(const BoxDims(5, 5, 5)).radius),
      );
    });

    test('the floor grid is 1 ft apart and bounded', () {
      final scene = layoutScene(const BoxDims(120, 120, 120));
      final lines = floorGrid(scene);
      expect(lines.length, lessThanOrEqualTo(38));
      expect(lines.every((l) => l.a.y == 0 && l.b.y == 0), isTrue);
      final xs = {
        for (final l in lines)
          if (l.a.x == l.b.x) l.a.x,
      }.toList()..sort();
      expect(xs[1] - xs[0], boxGridStepIn);
    });

    test('the sneaker has its profile and faces; the person is 66 in', () {
      final faces = sneakerFaces(const V3(0, 0, 0));
      expect(faces, hasLength(2 + sneakerProfile.length));
      final maxX = sneakerProfile.map((p) => p.$1).reduce(math.max);
      final maxY = sneakerProfile.map((p) => p.$2).reduce(math.max);
      expect(maxX, boxSneakerLengthIn);
      expect(maxY, boxSneakerHeightIn);
      expect(boxPersonHeightIn, 66);
    });
  });
}
