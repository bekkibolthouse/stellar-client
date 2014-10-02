var sc = angular.module('stellarClient');

sc.controller('TradingFormCtrl', function($scope, session, singletonPromise, FlashMessages) {
  // Populate the currency lists from the wallet's gateways.
  var gateways = session.get('wallet').get('mainData', 'gateways', []);
  var gatewayCurrencies = _.flatten(_.pluck(gateways, 'currencies'));
  $scope.currencies = [{currency:"STR"}].concat(gatewayCurrencies);
  $scope.currencyNames = _.uniq(_.pluck($scope.currencies, 'currency'));
  var MAX_STR_AMOUNT = new BigNumber(2).toPower(64).minus(1).dividedBy('1000000'); // (2^64-1)/10^6
  var MAX_CREDIT_PRECISION = 14; // stellard credits supports up to 15 significant digits


  $scope.$watch('formData.baseAmount', calculateCounterAmount);
  $scope.$watch('formData.unitPrice', calculateCounterAmount);

  $scope.changeBaseCurrency = function(newCurrency) {
    $scope.formData.baseCurrency = {
      currency: newCurrency,
      issuer: $scope.getIssuers(newCurrency)[0]
    };
  };

  $scope.changeCounterCurrency = function(newCurrency) {
    $scope.formData.counterCurrency = {
      currency: newCurrency,
      issuer: $scope.getIssuers(newCurrency)[0]
    };
  };

  function calculateCounterAmount() {
    $scope.formData.counterAmount = new BigNumber($scope.formData.baseAmount).times($scope.formData.unitPrice).toString();
  }

  $scope.getIssuers = function(currency) {
    var currencies = _.filter($scope.currencies, {currency: currency});
    var issuers = _.pluck(currencies, 'issuer');

    return issuers;
  };

  $scope.setBaseIssuer = function(issuer) {
    $scope.formData.baseCurrency.issuer = issuer;
  };

  $scope.setCounterIssuer = function(issuer) {
    $scope.formData.counterCurrency.issuer = issuer;
  };

  $scope.confirmOffer = function() {
    $scope.state = 'confirm';
  };

  $scope.editForm = function() {
    $scope.state = 'form';
  };

  $scope.resetForm = function() {
    $scope.state = 'form';
    $scope.formData.tradeOperation = 'buy';

    $scope.clearForm();

    $scope.$broadcast('trading-form-controller:reset');
  };

  $scope.clearForm = function() {
    $scope.resetAmounts();

    $scope.formData.baseCurrency = {
      currency: null,
      issuer: null
    };

    $scope.formData.counterCurrency = {
      currency: null,
      issuer: null
    };

    $scope.formData.favorite = null;
    $scope.offerError = '';
  };

  $scope.resetAmounts = function() {
    $scope.formData.baseAmount = null;
    $scope.formData.unitPrice = null;
    $scope.formData.counterAmount = null;
  };

  $scope.resetForm();

  $scope.formFilled = function() {
    if (!$scope.currentOrderBook) { return false; }

    if (!$scope.formData.baseCurrency.currency) { return false; }
    if (!$scope.formData.counterCurrency.currency) { return false; }

    if ($scope.formData.baseAmount === '') { return false; }
    if ($scope.formData.baseAmount === null) { return false; }
    if ($scope.formData.baseAmount === '0') { return false; }

    if ($scope.formData.unitPrice === '') { return false; }
    if ($scope.formData.unitPrice === null) { return false; }
    if ($scope.formData.unitPrice === '0') { return false; }

    if ($scope.formData.counterAmount === '') { return false; }
    if ($scope.formData.counterAmount === null) { return false; }
    if ($scope.formData.counterAmount === '0') { return false; }

    return true;
  };

  $scope.formIsValid = function() {
    var errorMessage = $scope.formErrorMessage();
    if (errorMessage) {
      return false;
    }

    return true;
  };

  $scope.canSubmit = function() {
    return $scope.formFilled() && $scope.formIsValid();
  };

  $scope.formErrorMessage = function() {
    try {
      validateForm();
    } catch (e) {
      return e.message;
    }
  };

  function validateForm() {
    var amounts = [
      _.extend({value: $scope.formData.baseAmount},    $scope.formData.baseCurrency),
      _.extend({value: $scope.formData.unitPrice},     $scope.formData.counterCurrency),
      _.extend({value: $scope.formData.counterAmount}, $scope.formData.counterCurrency),
    ];

    _.forEach(amounts, validateTradeAmount);
  }

  function validateTradeAmount(amount) {
    if (amount.value === null) {
      return;
    }

    var value;
    try {
      value = new BigNumber(amount.value);
    } catch (e) {
      throw new Error('Error parsing amount: ' + amount.value);
    }

    var amountNegative    = value.lessThanOrEqualTo(0);
    var STRBoundsError    = amount.currency === "STR" && value.greaterThan(MAX_STR_AMOUNT);
    var STRPrecisionError = amount.currency === "STR" && !value.equals(value.toFixed(6));
    var creditBoundsError = amount.currency !== "STR" && value.c.length > MAX_CREDIT_PRECISION;

    if (amountNegative) {
      throw new Error(amount.currency + ' amount must be a positive number');
    }
    if (STRBoundsError) {
      throw new Error('STR amount is too large: ' + value.toString());
    }
    if (STRPrecisionError) {
      throw new Error('STR amount has too many decimals: ' + value.toString());
    }
    if (creditBoundsError) {
      throw new Error(amount.currency + ' amount has too much precision: ' + value.toString());
    }
  }

  $scope.createOffer = singletonPromise(function(e) {
    var offerPromise;

    if ($scope.formData.tradeOperation === 'buy') {
      offerPromise = $scope.currentOrderBook.buy($scope.formData.baseAmount, $scope.formData.counterAmount);
    } else {
      offerPromise = $scope.currentOrderBook.sell($scope.formData.baseAmount, $scope.formData.counterAmount);
    }

    $scope.state = 'sending';
    
    return offerPromise
      .then(function() {
        if($scope.state === 'sending') {
          $scope.state = 'sent';
        } else {
          FlashMessages.add({
            title: 'Success!',
            info: 'Offer created.',
            type: 'success'
          });
        }
      })
      .catch(function(e) {
        if($scope.state === 'sending') {
          $scope.state = 'error';
          $scope.offerError = e.engine_result_message;
        } else {
          FlashMessages.add({
            title: 'Unable to create offer!',
            info: e.engine_result_message,
            type: 'error'
          });
        }
      });
  });
});