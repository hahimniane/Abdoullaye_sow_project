/// The box designer's geometry (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §4): the
/// inches a customer types, the 3D scene those inches make (a cardboard box
/// on a floor, a sneaker beside it, a 5 ft 6 in person behind it, a 1-ft
/// grid) and the perspective projection that turns the scene into screen
/// points.
///
/// Pure Dart with no Flutter import, so every rule is unit-tested without a
/// widget (`test/box_geometry_test.dart`). The painter and the widget are
/// thin glue over it.
///
/// Cost: a frame projects the box's 8 vertices, the sneaker's few and the
/// grid's end points - a constant, never a function of the data. The
/// auto-fit zoom comes from the scene's bounding sphere, which depends on
/// the inches only, so spinning never recomputes it.
library;

import 'dart:math' as math;

/// The slider covers 1 to 60 inches; a typed side may go to 120.
const double boxSliderMaxIn = 60;
const double boxMinIn = 1;
const double boxTypedMaxIn = 120;

/// A sneaker is 12 x 4.5 x 5 inches; a person is 5 ft 6 in (66 in).
const double boxSneakerLengthIn = 12;
const double boxSneakerWidthIn = 4.5;
const double boxSneakerHeightIn = 5;
const double boxPersonHeightIn = 66;

/// One floor square is a foot.
const double boxGridStepIn = 12;

/// Tape is two inches wide.
const double boxTapeWidthIn = 2;

/// The view the box opens on and the tilt the finger may reach (radians:
/// from nearly side-on to nearly top-down).
const double boxDefaultYaw = -0.62;
const double boxDefaultTilt = 0.42;
const double boxMinTilt = 0.05;
const double boxMaxTilt = 1.3;

/// A number rounded to a tenth of an inch.
double roundTenth(double value) => (value * 10).round() / 10;

/// "12", "12.5" or "12,5" as inches: 1 to 120, rounded to a tenth; null for
/// anything else (empty, letters, 0.4, 121).
double? parseInches(String text) {
  final cleaned = text.trim().replaceAll(',', '.');
  if (cleaned.isEmpty) return null;
  final n = double.tryParse(cleaned);
  if (n == null || !n.isFinite) return null;
  final tenth = roundTenth(n);
  if (tenth < boxMinIn || tenth > boxTypedMaxIn) return null;
  return tenth;
}

/// Inches as shown in a field or a caption: no trailing ".0".
String inchesText(double value) {
  final tenth = roundTenth(value);
  return tenth == tenth.roundToDouble()
      ? tenth.toInt().toString()
      : tenth.toStringAsFixed(1);
}

/// Length, width and height of a box, in inches.
class BoxDims {
  const BoxDims(this.l, this.w, this.h);

  /// What a new box starts as: about a shoebox.
  static const start = BoxDims(14, 10, 8);

  /// `{l, w, h}` as the server stores it (`dimsIn`), or null when it is not
  /// a map of three numbers in range.
  static BoxDims? fromMap(Object? value) {
    if (value is! Map) return null;
    double? side(Object? v) {
      final n = v is num ? v.toDouble() : double.tryParse('${v ?? ''}');
      if (n == null || !n.isFinite) return null;
      final t = roundTenth(n);
      return t >= boxMinIn && t <= boxTypedMaxIn ? t : null;
    }

    final l = side(value['l']), w = side(value['w']), h = side(value['h']);
    return l == null || w == null || h == null ? null : BoxDims(l, w, h);
  }

  final double l;
  final double w;
  final double h;

  /// The `dimsIn` the server takes.
  Map<String, Object?> toMap() => {'l': l, 'w': w, 'h': h};

  /// "20 × 16 × 14 in" - the same line every screen shows.
  String get text =>
      '${inchesText(l)} × ${inchesText(w)} × ${inchesText(h)} in';

  BoxDims copyWith({double? l, double? w, double? h}) =>
      BoxDims(l ?? this.l, w ?? this.w, h ?? this.h);

  /// Each side kept within 1..120 and a tenth.
  BoxDims get clamped => BoxDims(_side(l), _side(w), _side(h));

  static double _side(double v) =>
      roundTenth(v.clamp(boxMinIn, boxTypedMaxIn).toDouble());

  @override
  bool operator ==(Object other) =>
      other is BoxDims && other.l == l && other.w == w && other.h == h;

  @override
  int get hashCode => Object.hash(l, w, h);

  @override
  String toString() => 'BoxDims($l, $w, $h)';
}

/// A tilt kept where the box can be read.
double clampTilt(double tilt) => tilt.clamp(boxMinTilt, boxMaxTilt).toDouble();

/// A yaw kept within one turn, so a long drag never grows without bound.
double wrapYaw(double yaw) {
  const turn = 2 * math.pi;
  final wrapped = yaw % turn;
  return wrapped > math.pi ? wrapped - turn : wrapped;
}

// ---------------------------------------------------------------------------
// The scene in world inches: x right, y up, z toward the viewer at yaw 0.
// ---------------------------------------------------------------------------

class V3 {
  const V3(this.x, this.y, this.z);

  final double x;
  final double y;
  final double z;

  V3 operator +(V3 o) => V3(x + o.x, y + o.y, z + o.z);
  V3 operator -(V3 o) => V3(x - o.x, y - o.y, z - o.z);
  V3 scaled(double k) => V3(x * k, y * k, z * k);
  double dot(V3 o) => x * o.x + y * o.y + z * o.z;
  V3 cross(V3 o) => V3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x);
}

/// A point on the screen, with how far from the camera it is.
class ScreenPoint {
  const ScreenPoint(this.x, this.y, this.depth);

  final double x;
  final double y;
  final double depth;
}

/// The box's 8 corners, standing on the floor and centred on it: 0-3 are the
/// bottom (back-left, back-right, front-right, front-left), 4-7 the top in
/// the same order.
List<V3> boxVertices(BoxDims d) {
  final hx = d.l / 2, hz = d.w / 2;
  return [
    V3(-hx, 0, -hz),
    V3(hx, 0, -hz),
    V3(hx, 0, hz),
    V3(-hx, 0, hz),
    V3(-hx, d.h, -hz),
    V3(hx, d.h, -hz),
    V3(hx, d.h, hz),
    V3(-hx, d.h, hz),
  ];
}

/// A face of the box: its 4 corner indexes and its outward normal.
class BoxFace {
  const BoxFace(this.corners, this.normal);

  final List<int> corners;
  final V3 normal;
}

const List<BoxFace> boxFaces = [
  BoxFace([3, 2, 6, 7], V3(0, 0, 1)), // front
  BoxFace([1, 0, 4, 5], V3(0, 0, -1)), // back
  BoxFace([0, 3, 7, 4], V3(-1, 0, 0)), // left
  BoxFace([2, 1, 5, 6], V3(1, 0, 0)), // right
  BoxFace([7, 6, 5, 4], V3(0, 1, 0)), // top
];

/// The sneaker's side profile in (length, height) inches: heel, sole, toe
/// box, laces, collar.
const List<(double, double)> sneakerProfile = [
  (0, 0),
  (12, 0),
  (12, 1.5),
  (10.4, 2.7),
  (7.8, 3.3),
  (6.4, 4.7),
  (4.2, 5),
  (1.5, 5),
  (0, 3.7),
];

/// Where everything stands for one box.
class BoxScene {
  const BoxScene({
    required this.dims,
    required this.sneakerOrigin,
    required this.personFoot,
    required this.center,
    required this.radius,
    required this.gridCells,
  });

  final BoxDims dims;

  /// The sneaker's heel on the floor (its length runs along x).
  final V3 sneakerOrigin;

  /// The person's feet.
  final V3 personFoot;

  /// The middle of everything, and the radius of a sphere holding it: what
  /// the camera aims at and fits.
  final V3 center;
  final double radius;

  /// Floor lines per side of the middle, 1 ft apart.
  final int gridCells;
}

/// Lays the scene out for [dims]: the box at the middle, the sneaker beside
/// it on the right, the person behind on the left.
BoxScene layoutScene(BoxDims dims) {
  final d = dims.clamped;
  final sneaker = V3(d.l / 2 + 8, 0, 0);
  final person = V3(-(d.l / 2 + 16), 0, -(d.w / 2 + 10));
  // Bounding box of what must stay in view.
  final minX = math.min(-d.l / 2, person.x - 10);
  final maxX = math.max(d.l / 2, sneaker.x + boxSneakerLengthIn);
  final minZ = math.min(-d.w / 2, person.z - 3);
  final maxZ = math.max(d.w / 2, boxSneakerWidthIn / 2);
  final maxY = math.max(d.h, boxPersonHeightIn);
  final center = V3((minX + maxX) / 2, maxY / 2, (minZ + maxZ) / 2);
  final half = V3((maxX - minX) / 2, maxY / 2, (maxZ - minZ) / 2);
  final radius = math.sqrt(half.dot(half));
  final cells = ((radius / boxGridStepIn).ceil() + 1).clamp(3, 9);
  return BoxScene(
    dims: d,
    sneakerOrigin: sneaker,
    personFoot: person,
    center: center,
    radius: radius,
    gridCells: cells,
  );
}

// ---------------------------------------------------------------------------
// The camera.
// ---------------------------------------------------------------------------

/// A perspective camera aimed at the scene's middle: [yaw] spins the scene
/// about the vertical, [tilt] lifts the camera above the floor, [radius] is
/// the bounding sphere to keep in view inside a [viewport].
class SceneCamera {
  SceneCamera({
    required this.center,
    required this.radius,
    required this.yaw,
    required double tilt,
    required this.width,
    required this.height,
    this.margin = 0.92,
  }) : tilt = clampTilt(tilt),
       _cosY = math.cos(yaw),
       _sinY = math.sin(yaw),
       _cosT = math.cos(clampTilt(tilt)),
       _sinT = math.sin(clampTilt(tilt)) {
    // A camera three radii away is a mild perspective; the focal length
    // makes the bounding sphere fill [margin] of the shorter side.
    distance = radius * 3;
    final reach = math.sqrt(distance * distance - radius * radius);
    focal = (math.min(width, height) / 2) * margin * reach / radius;
  }

  final V3 center;
  final double radius;
  final double yaw;
  final double tilt;
  final double width;
  final double height;
  final double margin;
  late final double distance;
  late final double focal;

  final double _cosY, _sinY, _cosT, _sinT;

  /// A world point in camera space (the scene's middle at the origin, +z
  /// toward the camera).
  V3 view(V3 p) {
    final x = p.x - center.x, y = p.y - center.y, z = p.z - center.z;
    final x1 = x * _cosY + z * _sinY;
    final z1 = -x * _sinY + z * _cosY;
    return V3(x1, y * _cosT - z1 * _sinT, y * _sinT + z1 * _cosT);
  }

  /// A world direction in camera space (no translation).
  V3 viewDirection(V3 n) {
    final x1 = n.x * _cosY + n.z * _sinY;
    final z1 = -n.x * _sinY + n.z * _cosY;
    return V3(x1, n.y * _cosT - z1 * _sinT, n.y * _sinT + z1 * _cosT);
  }

  ScreenPoint project(V3 p) => projectView(view(p));

  ScreenPoint projectView(V3 v) {
    final depth = distance - v.z;
    final k = focal / depth;
    return ScreenPoint(width / 2 + v.x * k, height / 2 - v.y * k, depth);
  }

  /// Whether a face whose middle is [faceCenter] with outward [normal] (both
  /// in the world) turns toward the camera.
  bool facesCamera(V3 faceCenter, V3 normal) {
    final c = view(faceCenter);
    final n = viewDirection(normal);
    final toCamera = V3(-c.x, -c.y, distance - c.z);
    return n.dot(toCamera) > 0;
  }
}

// ---------------------------------------------------------------------------
// The floor grid.
// ---------------------------------------------------------------------------

/// One end-to-end floor line.
class GridLine {
  const GridLine(this.a, this.b, {this.major = false});

  final V3 a;
  final V3 b;

  /// The lines through the middle are drawn a little stronger.
  final bool major;
}

/// The 1-ft lines of the floor for [scene], at most 38 of them.
List<GridLine> floorGrid(BoxScene scene) {
  final n = scene.gridCells;
  final reach = n * boxGridStepIn;
  final cx = (scene.center.x / boxGridStepIn).roundToDouble() * boxGridStepIn;
  final cz = (scene.center.z / boxGridStepIn).roundToDouble() * boxGridStepIn;
  return [
    for (var i = -n; i <= n; i++) ...[
      GridLine(
        V3(cx + i * boxGridStepIn, 0, cz - reach),
        V3(cx + i * boxGridStepIn, 0, cz + reach),
        major: cx + i * boxGridStepIn == 0,
      ),
      GridLine(
        V3(cx - reach, 0, cz + i * boxGridStepIn),
        V3(cx + reach, 0, cz + i * boxGridStepIn),
        major: cz + i * boxGridStepIn == 0,
      ),
    ],
  ];
}

// ---------------------------------------------------------------------------
// The sneaker as a prism.
// ---------------------------------------------------------------------------

/// A flat face of the sneaker: world corners and outward normal.
class PrismFace {
  const PrismFace(this.corners, this.normal);

  final List<V3> corners;
  final V3 normal;

  V3 get middle {
    var sum = const V3(0, 0, 0);
    for (final c in corners) {
      sum = sum + c;
    }
    return sum.scaled(1 / corners.length);
  }
}

/// The sneaker's faces: its two sides and the strip around the profile.
List<PrismFace> sneakerFaces(V3 origin) {
  final half = boxSneakerWidthIn / 2;
  final near = <V3>[
    for (final p in sneakerProfile) V3(origin.x + p.$1, p.$2, origin.z + half),
  ];
  final far = <V3>[
    for (final p in sneakerProfile) V3(origin.x + p.$1, p.$2, origin.z - half),
  ];
  final faces = <PrismFace>[
    PrismFace(near, const V3(0, 0, 1)),
    PrismFace(far.reversed.toList(), const V3(0, 0, -1)),
  ];
  for (var i = 0; i < sneakerProfile.length; i++) {
    final j = (i + 1) % sneakerProfile.length;
    final a = sneakerProfile[i], b = sneakerProfile[j];
    // The profile runs heel -> sole -> toe -> collar -> heel
    // (counter-clockwise seen from +z), so an edge's outward normal is its
    // direction turned a quarter to the right.
    final dx = b.$1 - a.$1, dy = b.$2 - a.$2;
    final len = math.sqrt(dx * dx + dy * dy);
    if (len == 0) continue;
    faces.add(
      PrismFace([near[i], near[j], far[j], far[i]], V3(dy / len, -dx / len, 0)),
    );
  }
  return faces;
}

// ---------------------------------------------------------------------------
// Light.
// ---------------------------------------------------------------------------

/// How lit a face with camera-space [normal] is, 0.55 (in shade) to 1.
double faceLight(V3 normal) {
  const light = V3(-0.35, 0.8, 0.5);
  final len = math.sqrt(light.dot(light));
  final lit = math.max(0.0, normal.dot(light.scaled(1 / len)));
  return 0.55 + 0.45 * lit;
}

/// Every screen point the scene can occupy at [camera]: the box, the
/// sneaker and the person's head and feet. What "everything fits" is tested
/// against.
List<ScreenPoint> sceneExtremes(BoxScene scene, SceneCamera camera) {
  final out = <ScreenPoint>[
    for (final v in boxVertices(scene.dims)) camera.project(v),
  ];
  for (final face in sneakerFaces(scene.sneakerOrigin)) {
    for (final c in face.corners) {
      out.add(camera.project(c));
    }
  }
  final foot = scene.personFoot;
  out
    ..add(camera.project(foot))
    ..add(camera.project(V3(foot.x, boxPersonHeightIn, foot.z)));
  return out;
}
