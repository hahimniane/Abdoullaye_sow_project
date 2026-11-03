import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';

/// Picks a calendar day the way the platform does: the iOS wheel in a bottom
/// popup (Cancel / Done), the Material calendar elsewhere - the same split
/// the parking forms use. Answers that day at local midnight, or null when
/// the person cancelled.
///
/// [selectable] rules days out (a closed shop's Sundays): the Material
/// calendar greys them and cannot pick them; the iOS wheel cannot grey a day,
/// so Done moves a ruled-out day on to the next day that is allowed. Null
/// when no day in range is allowed.
Future<DateTime?> pickCalendarDay(
  BuildContext context, {
  required DateTime initial,
  required DateTime first,
  required DateTime last,
  bool Function(DateTime day)? selectable,
}) async {
  DateTime day(DateTime d) => DateTime(d.year, d.month, d.day);
  final lo = day(first);
  final hi = day(last);
  var start = day(initial);
  if (start.isBefore(lo)) start = lo;
  if (start.isAfter(hi)) start = hi;
  if (selectable != null && !selectable(start)) {
    // The calendar asserts its first day is allowed.
    DateTime? next(DateTime from) {
      for (
        var d = from;
        !d.isAfter(hi);
        d = DateTime(d.year, d.month, d.day + 1)
      ) {
        if (selectable(d)) return d;
      }
      return null;
    }

    final found = next(start) ?? next(lo);
    if (found == null) return null;
    start = found;
  }

  if (defaultTargetPlatform != TargetPlatform.iOS) {
    final picked = await showDatePicker(
      context: context,
      initialDate: start,
      firstDate: lo,
      lastDate: hi,
      selectableDayPredicate: selectable == null
          ? null
          : (d) => selectable(day(d)),
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
  if (done != true) return null;
  if (selectable == null || selectable(chosen)) return chosen;
  for (
    var d = chosen;
    !d.isAfter(hi);
    d = DateTime(d.year, d.month, d.day + 1)
  ) {
    if (selectable(d)) return d;
  }
  return null;
}
