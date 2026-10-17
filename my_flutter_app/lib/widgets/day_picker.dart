import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';

/// Picks a calendar day the way the platform does: the iOS wheel in a bottom
/// popup (Cancel / Done), the Material calendar elsewhere - the same split
/// the parking forms use. Answers that day at local midnight, or null when
/// the person cancelled.
Future<DateTime?> pickCalendarDay(
  BuildContext context, {
  required DateTime initial,
  required DateTime first,
  required DateTime last,
}) async {
  DateTime day(DateTime d) => DateTime(d.year, d.month, d.day);
  final lo = day(first);
  final hi = day(last);
  var start = day(initial);
  if (start.isBefore(lo)) start = lo;
  if (start.isAfter(hi)) start = hi;

  if (defaultTargetPlatform != TargetPlatform.iOS) {
    final picked = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: lo,
      lastDate: hi,
    );
    return picked == null ? null : day(picked);
  }

  final l10n = AppLocalizations.of(context)!;
  var chosen = start;
  final done = await showCupertinoModalPopup<bool>(
    context: context,
    builder: (popupContext) => Container(
      height: 300,
      padding: const EdgeInsets.only(top: 6),
      color: CupertinoColors.systemBackground.resolveFrom(popupContext),
      child: SafeArea(
        top: false,
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                CupertinoButton(
                  child: Text(l10n.cancel),
                  onPressed: () => Navigator.of(popupContext).pop(false),
                ),
                CupertinoButton(
                  key: const Key('day-picker-done'),
                  child: Text(l10n.done),
                  onPressed: () => Navigator.of(popupContext).pop(true),
                ),
              ],
            ),
            Expanded(
              child: CupertinoDatePicker(
                mode: CupertinoDatePickerMode.date,
                initialDateTime: start,
                minimumDate: lo,
                maximumDate: hi,
                onDateTimeChanged: (value) => chosen = day(value),
              ),
            ),
          ],
        ),
      ),
    ),
  );
  return done == true ? chosen : null;
}
