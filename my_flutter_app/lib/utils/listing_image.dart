import 'package:flutter/widgets.dart';

/// Marketplace photos are downscaled on the phone before upload: nothing in
/// the app shows a listing photo wider than a phone's gallery, so the full
/// camera original only cost every buyer a bigger download and decode.
const double listingPhotoMaxDimension = 1600;

/// JPEG quality for uploaded listing photos.
const int listingPhotoQuality = 80;

/// The widest a listing photo is ever decoded to, in physical pixels.
const int listingImageMaxDecodeWidth = 2048;

/// Car photos are landscape, rarely wider than 16:9. Decoding to
/// `height * aspect` covers a box whose `BoxFit.cover` crops by height
/// without upscaling a too-small bitmap.
const double _assumedWidestAspect = 16 / 9;

/// The width to decode a network photo at for a box of [width] x [height]
/// logical pixels shown with `BoxFit.cover`, or null when the box is
/// unbounded (then the image decodes at its own size, as before).
///
/// Without a decode size every thumbnail held a full-resolution bitmap in
/// memory; a list of thirty cars was thirty camera originals.
int? listingImageDecodeWidth({
  required double width,
  required double height,
  required double devicePixelRatio,
}) {
  final w = width.isFinite && width > 0 ? width : 0.0;
  final h = height.isFinite && height > 0 ? height * _assumedWidestAspect : 0.0;
  final logical = w > h ? w : h;
  if (logical <= 0) return null;
  final ratio = devicePixelRatio.isFinite && devicePixelRatio > 0
      ? devicePixelRatio
      : 1.0;
  final physical = (logical * ratio).ceil();
  return physical > listingImageMaxDecodeWidth
      ? listingImageMaxDecodeWidth
      : physical;
}

/// `Image.network` for a listing photo, decoded at the size it is shown.
///
/// Measures its box with a LayoutBuilder, so callers that size the photo by
/// its parent (a full-width card, a gallery page) still decode at the real
/// width. No disk cache: no caching package is a dependency, and Flutter's
/// in-memory image cache already serves repeat views in a session.
class ListingNetworkImage extends StatelessWidget {
  const ListingNetworkImage(
    this.url, {
    super.key,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.errorBuilder,
    this.loadingBuilder,
  });

  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final ImageErrorWidgetBuilder? errorBuilder;
  final ImageLoadingBuilder? loadingBuilder;

  @override
  Widget build(BuildContext context) {
    final ratio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 1.0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final boxWidth = width != null && width!.isFinite
            ? width!
            : constraints.maxWidth;
        final boxHeight = height != null && height!.isFinite
            ? height!
            : constraints.maxHeight;
        return Image.network(
          url,
          width: width,
          height: height,
          fit: fit,
          cacheWidth: listingImageDecodeWidth(
            width: boxWidth,
            height: boxHeight,
            devicePixelRatio: ratio,
          ),
          errorBuilder: errorBuilder,
          loadingBuilder: loadingBuilder,
        );
      },
    );
  }
}
