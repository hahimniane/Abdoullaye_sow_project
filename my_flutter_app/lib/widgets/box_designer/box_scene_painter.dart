import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import 'box_geometry.dart';

/// How the scene is framed: the point the camera aims at and the radius of
/// the sphere kept in view. Animated (or not, with reduced motion) when the
/// inches change.
@immutable
class SceneFraming {
  const SceneFraming(this.center, this.radius);

  factory SceneFraming.of(BoxScene scene) =>
      SceneFraming(scene.center, scene.radius);

  final V3 center;
  final double radius;

  static SceneFraming lerp(SceneFraming a, SceneFraming b, double t) =>
      SceneFraming(
        V3(
          a.center.x + (b.center.x - a.center.x) * t,
          a.center.y + (b.center.y - a.center.y) * t,
          a.center.z + (b.center.z - a.center.z) * t,
        ),
        a.radius + (b.radius - a.radius) * t,
      );

  @override
  bool operator ==(Object other) =>
      other is SceneFraming &&
      other.radius == radius &&
      other.center.x == center.x &&
      other.center.y == center.y &&
      other.center.z == center.z;

  @override
  int get hashCode => Object.hash(center.x, center.y, center.z, radius);
}

class SceneFramingTween extends Tween<SceneFraming> {
  SceneFramingTween({super.begin, super.end});

  @override
  SceneFraming lerp(double t) => SceneFraming.lerp(begin!, end!, t);
}

/// The spin: how far round and how far above the floor the camera is.
@immutable
class SceneSpin {
  const SceneSpin(this.yaw, this.tilt);

  static const start = SceneSpin(boxDefaultYaw, boxDefaultTilt);

  final double yaw;
  final double tilt;

  SceneSpin dragged(double dx, double dy) =>
      SceneSpin(wrapYaw(yaw + dx * 0.012), clampTilt(tilt + dy * 0.008));
}

/// Draws the box, the sneaker, the person and the floor. Repaints on the
/// spin notifier alone, so a drag never rebuilds a widget.
class BoxScenePainter extends CustomPainter {
  BoxScenePainter({
    required this.scene,
    required this.framing,
    required this.spin,
  }) : super(repaint: spin);

  final BoxScene scene;
  final SceneFraming framing;
  final ValueListenable<SceneSpin> spin;

  static const _cardboard = Color(0xFFC99A5B);
  static const _tape = Color(0xFFEBDDB4);
  static const _edge = Color(0xFF6E4B22);
  static const _sneaker = AppColors.cobalt;
  static const _person = Color(0xFF94A3B8);

  /// A 5 ft 6 in person in inches, feet at y = 0 (drawn flipped to the
  /// screen): head, torso, arms, legs.
  static final Path _personPath = () {
    final p = Path()
      ..addOval(Rect.fromCircle(center: const Offset(0, 61.3), radius: 4.7))
      ..addRRect(RRect.fromLTRBR(-8.4, 34, 8.4, 57, const Radius.circular(4)))
      ..addRRect(
        RRect.fromLTRBR(-12.4, 35, -9.2, 56, const Radius.circular(1.6)),
      )
      ..addRRect(RRect.fromLTRBR(9.2, 35, 12.4, 56, const Radius.circular(1.6)))
      ..addRRect(RRect.fromLTRBR(-7.6, 0, -0.7, 35.5, const Radius.circular(2)))
      ..addRRect(RRect.fromLTRBR(0.7, 0, 7.6, 35.5, const Radius.circular(2)));
    return p;
  }();

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    final camera = SceneCamera(
      center: framing.center,
      radius: framing.radius,
      yaw: spin.value.yaw,
      tilt: spin.value.tilt,
      width: size.width,
      height: size.height,
    );
    _paintFloor(canvas, camera);

    // Far things first: the person, the box and the sneaker by how far
    // their middles are from the camera.
    final box = scene.dims;
    final boxDepth = camera.view(V3(0, box.h / 2, 0)).z;
    final sneakerMid = V3(
      scene.sneakerOrigin.x + boxSneakerLengthIn / 2,
      boxSneakerHeightIn / 2,
      scene.sneakerOrigin.z,
    );
    final personMid = V3(
      scene.personFoot.x,
      boxPersonHeightIn / 2,
      scene.personFoot.z,
    );
    final items = <(double, VoidCallback)>[
      (camera.view(personMid).z, () => _paintPerson(canvas, camera)),
      (boxDepth, () => _paintBox(canvas, camera)),
      (camera.view(sneakerMid).z, () => _paintSneaker(canvas, camera)),
    ]..sort((a, b) => a.$1.compareTo(b.$1));
    for (final item in items) {
      item.$2();
    }
  }

  void _paintFloor(Canvas canvas, SceneCamera camera) {
    final minor = Paint()
      ..color = AppColors.rule
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    final major = Paint()
      ..color = const Color(0xFFB6C2D0)
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    final lines = floorGrid(scene);
    for (final line in lines) {
      final a = camera.project(line.a), b = camera.project(line.b);
      canvas.drawLine(
        Offset(a.x, a.y),
        Offset(b.x, b.y),
        line.major ? major : minor,
      );
    }
  }

  void _paintPerson(Canvas canvas, SceneCamera camera) {
    final foot = camera.project(scene.personFoot);
    final head = camera.project(
      V3(scene.personFoot.x, boxPersonHeightIn, scene.personFoot.z),
    );
    final scale = (foot.y - head.y) / boxPersonHeightIn;
    if (!(scale > 0) || !scale.isFinite) return;
    canvas
      ..save()
      ..translate(foot.x, foot.y)
      ..scale(scale, -scale)
      ..drawPath(_personPath, Paint()..color = _person.withValues(alpha: 0.7))
      ..restore();
  }

  void _paintBox(Canvas canvas, SceneCamera camera) {
    final d = scene.dims;
    final verts = boxVertices(d);
    final screen = [for (final v in verts) camera.project(v)];
    Path polygon(List<int> corners) {
      final path = Path()..moveTo(screen[corners[0]].x, screen[corners[0]].y);
      for (var i = 1; i < corners.length; i++) {
        path.lineTo(screen[corners[i]].x, screen[corners[i]].y);
      }
      return path..close();
    }

    final edge = Paint()
      ..color = _edge
      ..strokeWidth = 1.2
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    final tapeHalf = math.min(boxTapeWidthIn / 2, d.l / 2);
    for (final face in boxFaces) {
      var mid = const V3(0, 0, 0);
      for (final c in face.corners) {
        mid = mid + verts[c];
      }
      mid = mid.scaled(1 / 4);
      if (!camera.facesCamera(mid, face.normal)) continue;
      final light = faceLight(camera.viewDirection(face.normal));
      canvas.drawPath(
        polygon(face.corners),
        Paint()..color = Color.lerp(Colors.black, _cardboard, light)!,
      );
      // The tape runs over the top and down the front and back, across the
      // middle of the length.
      final onTop = face.normal.y > 0;
      final onEnd = face.normal.z != 0;
      if (onTop || onEnd) {
        final z = face.normal.z;
        final depthDown = math.min(d.h, 6.0);
        final quad = onTop
            ? [
                V3(-tapeHalf, d.h, -d.w / 2),
                V3(tapeHalf, d.h, -d.w / 2),
                V3(tapeHalf, d.h, d.w / 2),
                V3(-tapeHalf, d.h, d.w / 2),
              ]
            : [
                V3(-tapeHalf, d.h, z * d.w / 2),
                V3(tapeHalf, d.h, z * d.w / 2),
                V3(tapeHalf, d.h - depthDown, z * d.w / 2),
                V3(-tapeHalf, d.h - depthDown, z * d.w / 2),
              ];
        final path = Path();
        for (var i = 0; i < quad.length; i++) {
          final p = camera.project(quad[i]);
          i == 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y);
        }
        path.close();
        canvas.drawPath(
          path,
          Paint()..color = Color.lerp(Colors.black, _tape, light)!,
        );
      }
      canvas.drawPath(polygon(face.corners), edge);
    }
  }

  void _paintSneaker(Canvas canvas, SceneCamera camera) {
    final edge = Paint()
      ..color = AppColors.cobaltDeep
      ..strokeWidth = 0.8
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;
    for (final face in sneakerFaces(scene.sneakerOrigin)) {
      if (!camera.facesCamera(face.middle, face.normal)) continue;
      final light = faceLight(camera.viewDirection(face.normal));
      final path = Path();
      for (var i = 0; i < face.corners.length; i++) {
        final p = camera.project(face.corners[i]);
        i == 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y);
      }
      path.close();
      canvas
        ..drawPath(
          path,
          Paint()..color = Color.lerp(Colors.black, _sneaker, light)!,
        )
        ..drawPath(path, edge);
    }
  }

  @override
  bool shouldRepaint(BoxScenePainter old) =>
      old.scene.dims != scene.dims ||
      old.framing != framing ||
      old.spin != spin;
}
