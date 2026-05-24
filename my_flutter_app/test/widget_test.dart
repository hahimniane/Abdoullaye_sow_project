import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/theme/app_colors.dart';

void main() {
  test('brand theme exposes professional light surface colors', () {
    expect(
      AppColors.lightSurface.toARGB32(),
      isNot(equals(AppColors.darkBg.toARGB32())),
    );
    expect(
      AppColors.brandRed.toARGB32(),
      isNot(equals(AppColors.brandBlack.toARGB32())),
    );
  });
}
