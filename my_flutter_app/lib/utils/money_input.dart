/// The one reader for money people type into the app.
///
/// Every money field - ledger fees and expenses, parking rates, destination
/// prices, transport quotes - goes through [readMoneyInput], so "12,50" means
/// the same twelve dollars fifty everywhere.
///
/// Both catalogs are in play, so both separators can be the decimal mark:
///
/// * `12.50`, `12,50`, `0,5`, `.5`      - one mark followed by one or two
///   digits is the decimal mark.
/// * `1,200`, `1,200.50`, `1.200,50`, `1 200,50` - a separator in valid
///   thousands grouping (one to three digits, then groups of exactly three) is
///   a thousands separator.
/// * `1,2,3`, `12,500,5`, `1,20.5`, `12.34.56` - neither reading is clean, so
///   the text is refused rather than guessed at. Guessing is how "12,50"
///   became $1,250.
/// * `12.505`, `1,250.005` - a number, but finer than a cent: refused with its
///   own reason so the message can say "two decimals at most" rather than
///   "not a number".
///
/// Money is integer cents end to end. The text is read as dollars and cents
/// separately and combined; nothing is ever multiplied by 100 as a double.
library;

/// Why typed money could not be read.
enum MoneyInputIssue {
  /// Nothing (or only a currency sign / spaces) was typed.
  empty,

  /// Not a number, or a separator pattern that has no single clean reading.
  invalid,

  /// A number with more precision than whole cents.
  fractionalCents,
}

/// The result of reading typed money: [cents] when usable, else [issue].
class MoneyInput {
  const MoneyInput.cents(int this.cents) : issue = null;
  const MoneyInput.refused(MoneyInputIssue this.issue) : cents = null;

  /// Signed whole cents. A negative amount reads as negative so callers can
  /// say "cannot be negative" instead of "not a number".
  final int? cents;
  final MoneyInputIssue? issue;

  bool get isValid => cents != null;
  bool get isEmpty => issue == MoneyInputIssue.empty;
}

/// Larger than any real amount and still well inside a safe integer.
const int _maxDollarDigits = 12;

final RegExp _spaces = RegExp(r'[\s  ]');
final RegExp _allowed = RegExp(r'^[0-9.,]+$');
final RegExp _digits = RegExp(r'^[0-9]*$');

/// Reads typed money. See the library comment for the rules.
MoneyInput readMoneyInput(String input) {
  var text = input.replaceAll(_spaces, '').replaceAll(r'$', '');
  if (text.isEmpty) return const MoneyInput.refused(MoneyInputIssue.empty);

  var negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.substring(1);
  }
  if (text.isEmpty || !_allowed.hasMatch(text)) {
    return const MoneyInput.refused(MoneyInputIssue.invalid);
  }

  final commas = ','.allMatches(text).length;
  final dots = '.'.allMatches(text).length;

  String? decimalMark;
  String? groupMark;
  if (commas > 0 && dots > 0) {
    // "1,200.50" / "1.200,50": the later one is the decimal mark, once.
    final lastComma = text.lastIndexOf(',');
    final lastDot = text.lastIndexOf('.');
    decimalMark = lastComma > lastDot ? ',' : '.';
    groupMark = decimalMark == ',' ? '.' : ',';
    final decimals = decimalMark == ',' ? commas : dots;
    if (decimals != 1) return const MoneyInput.refused(MoneyInputIssue.invalid);
  } else if (commas + dots == 1) {
    final mark = commas == 1 ? ',' : '.';
    final after = text.length - text.indexOf(mark) - 1;
    if (mark == ',' && after == 3) {
      // "1,250" is twelve hundred and fifty, the way it is written in English.
      groupMark = ',';
    } else if (mark == ',' && after > 3) {
      // "1,2345" is neither a group nor cents.
      return const MoneyInput.refused(MoneyInputIssue.invalid);
    } else {
      decimalMark = mark;
    }
  } else if (commas > 1 || dots > 1) {
    // Several of one mark: only thousands grouping makes sense ("1,200,000").
    groupMark = commas > 1 ? ',' : '.';
  }

  var whole = text;
  var fraction = '';
  if (decimalMark != null) {
    final at = text.lastIndexOf(decimalMark);
    whole = text.substring(0, at);
    fraction = text.substring(at + 1);
    // "12," / "12." - a mark with nothing after it is a half-typed amount.
    if (fraction.isEmpty || !_digits.hasMatch(fraction)) {
      return const MoneyInput.refused(MoneyInputIssue.invalid);
    }
  }
  if (groupMark != null) {
    final groups = whole.split(groupMark);
    final first = groups.first;
    if (first.isEmpty || first.length > 3 || !_digits.hasMatch(first)) {
      return const MoneyInput.refused(MoneyInputIssue.invalid);
    }
    for (final group in groups.skip(1)) {
      if (group.length != 3 || !_digits.hasMatch(group)) {
        return const MoneyInput.refused(MoneyInputIssue.invalid);
      }
    }
    whole = groups.join();
  }
  if (!_digits.hasMatch(whole) || (whole.isEmpty && fraction.isEmpty)) {
    return const MoneyInput.refused(MoneyInputIssue.invalid);
  }
  if (fraction.length > 2) {
    return const MoneyInput.refused(MoneyInputIssue.fractionalCents);
  }
  final trimmedWhole = whole.replaceFirst(RegExp(r'^0+(?=\d)'), '');
  if (trimmedWhole.length > _maxDollarDigits) {
    return const MoneyInput.refused(MoneyInputIssue.invalid);
  }

  final dollars = trimmedWhole.isEmpty ? 0 : int.parse(trimmedWhole);
  final cents = fraction.isEmpty ? 0 : int.parse(fraction.padRight(2, '0'));
  final total = dollars * 100 + cents;
  return MoneyInput.cents(negative ? -total : total);
}

/// Signed whole cents, or null when the text is empty or unusable.
int? parseMoneyCents(String input) => readMoneyInput(input).cents;

/// Dollars as a double for the fields stored in dollars (rates, prices), or
/// null when the text is empty or unusable. Read through cents, so it is
/// exact to the cent.
double? parseMoneyDollars(String input) {
  final cents = parseMoneyCents(input);
  return cents == null ? null : cents / 100;
}

/// Validator for an optional, non-negative money field: blank is fine, but
/// anything typed has to read cleanly. Returns [message] when it does not.
String? validateOptionalMoney(String? input, String message) {
  final read = readMoneyInput(input ?? '');
  if (read.isEmpty) return null;
  final cents = read.cents;
  return cents == null || cents < 0 ? message : null;
}

/// Validator for a required, non-negative money field.
String? validateRequiredMoney(String? input, String message) {
  final cents = parseMoneyCents(input ?? '');
  return cents == null || cents < 0 ? message : null;
}
