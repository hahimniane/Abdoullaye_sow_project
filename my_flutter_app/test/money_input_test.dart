import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_transport_jobs.dart';
import 'package:my_flutter_app/services/invoice_ledger.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/utils/money_input.dart';

void main() {
  group('readMoneyInput', () {
    test(
      'a French decimal comma is the decimal mark, not a thousands group',
      () {
        // The regression: the ledger stripped every comma, so "12,50" saved as
        // $1,250.00.
        expect(parseMoneyCents('12,50'), 1250);
        expect(parseMoneyCents('12,5'), 1250);
        expect(parseMoneyCents('0,99'), 99);
        expect(parseMoneyCents(',50'), 50);
        expect(lotDollarsToCents('12,50'), 1250);
        expect(invoiceDollarsToCents('12,50'), 1250);
        expect(parseTransportQuoteCents('12,50'), 1250);
      },
    );

    test('plain and US-formatted amounts', () {
      expect(parseMoneyCents('12'), 1200);
      expect(parseMoneyCents('12.5'), 1250);
      expect(parseMoneyCents('12.50'), 1250);
      expect(parseMoneyCents('.5'), 50);
      expect(parseMoneyCents(r'$1,200.00'), 120000);
      expect(parseMoneyCents(' \$1,250.50 '), 125050);
      expect(parseMoneyCents('1,250'), 125000);
      expect(parseMoneyCents('1,234,567.89'), 123456789);
      expect(parseMoneyCents('007'), 700);
    });

    test('French-formatted amounts', () {
      expect(parseMoneyCents('1250,50'), 125050);
      expect(parseMoneyCents('1 200,50'), 120050);
      expect(parseMoneyCents('1 200,50'), 120050);
      expect(parseMoneyCents('1 200,50'), 120050);
      expect(parseMoneyCents('1.200,50'), 120050);
      expect(parseMoneyCents('1.200.000'), 120000000);
    });

    test('ambiguous separators are refused, never guessed', () {
      for (final ambiguous in const [
        '1,2,3',
        '12,500,5',
        '1,20.5',
        '1.20,5',
        '12.34.56',
        '1,2345',
        '12,',
        '1,,200',
        ',',
        '.',
        '1.200.50,5',
      ]) {
        expect(
          readMoneyInput(ambiguous).issue,
          MoneyInputIssue.invalid,
          reason: ambiguous,
        );
      }
    });

    test('not a number at all', () {
      for (final rubbish in const ['abc', '1e5', '--5', '12a', '-', r'$']) {
        expect(parseMoneyCents(rubbish), isNull, reason: rubbish);
      }
    });

    test('empty is its own case', () {
      expect(readMoneyInput('').isEmpty, isTrue);
      expect(readMoneyInput('   ').isEmpty, isTrue);
      expect(parseMoneyCents(''), isNull);
    });

    test('finer than a cent is refused with its own reason', () {
      expect(readMoneyInput('12.505').issue, MoneyInputIssue.fractionalCents);
      expect(
        readMoneyInput('1,250.005').issue,
        MoneyInputIssue.fractionalCents,
      );
      expect(transportQuoteAmountIsFractional('1250.005'), isTrue);
      expect(transportQuoteAmountIsFractional('1250.50'), isFalse);
    });

    test('negatives keep their sign so callers can say why', () {
      expect(parseMoneyCents('-5'), -500);
      expect(parseMoneyCents('-12,50'), -1250);
    });

    test('absurdly long numbers are refused instead of overflowing', () {
      expect(parseMoneyCents('9999999999999999999'), isNull);
    });

    test('dollars are exact to the cent', () {
      expect(parseMoneyDollars('19,99'), 19.99);
      expect(parseMoneyDollars('x'), isNull);
    });
  });

  group('money validators', () {
    test('optional: blank passes, rubbish and negatives fail', () {
      expect(validateOptionalMoney('', 'bad'), isNull);
      expect(validateOptionalMoney(null, 'bad'), isNull);
      expect(validateOptionalMoney('12,50', 'bad'), isNull);
      expect(validateOptionalMoney('12,5,0', 'bad'), 'bad');
      expect(validateOptionalMoney('abc', 'bad'), 'bad');
      expect(validateOptionalMoney('-1', 'bad'), 'bad');
    });

    test('required: blank fails too', () {
      expect(validateRequiredMoney('', 'bad'), 'bad');
      expect(validateRequiredMoney('0', 'bad'), isNull);
    });
  });
}
