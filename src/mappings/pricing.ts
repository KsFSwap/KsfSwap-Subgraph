/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ADDRESS_ZERO, ONE_BD } from './helpers'
import { log } from '@graphprotocol/graph-ts'

const WKCS_ADDRESS = '0x4446fc4eb47f2f6586f9faab68b3498f86c07521'
// const USDC_WKCS_PAIR = '0xfa1a0a33b15165b814bc6cae44e1dd466471b116'
// const USDT_WKCS_PAIR = '0xd47dd27ba94b3c00058e2184cc5f4bd34ba5f077'

const USDC_WETH_PAIR = '0xc2cacd273630bc1dcb1c7ca398374896fa1d6322' 
const BUSD_WETH_PAIR = '0x26d94a2e3bd703847c3be3c30ead42b926b427c2' 
const USDT_WETH_PAIR = '0x1116b80fd0ff9a980dcfbfa3ed477bfa6bbd6a85'

export function getKcsPriceInUSD(): BigDecimal {
  let busdPair = Pair.load(BUSD_WETH_PAIR) // busd is token1
  let usdcPair = Pair.load(USDC_WETH_PAIR) // usdc is token1
  let usdtPair = Pair.load(USDT_WETH_PAIR) // usdt is token0

  // all 3 have been created
  if (busdPair !== null && usdcPair !== null && usdtPair !== null) {
    let totalLiquidityETH = busdPair.reserve0.plus(usdcPair.reserve0).plus(usdtPair.reserve1)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    let usdtWeight = usdtPair.reserve1.div(totalLiquidityETH)
    let kcfPrice = busdPair.token1Price
      .times(busdWeight)
      .plus(usdcPair.token1Price.times(usdcWeight))
      .plus(usdtPair.token0Price.times(usdtWeight))
    // log.info(`eth price returning is ` + kcfPrice.toString(), []);

    return kcfPrice
    // busd and USDC have been created
  } else if (busdPair !== null && usdcPair !== null) {
    let totalLiquidityETH = busdPair.reserve0.plus(usdcPair.reserve0)
    let busdWeight = busdPair.reserve0.div(totalLiquidityETH)
    let usdcWeight = usdcPair.reserve0.div(totalLiquidityETH)
    // log.info(`busdPair.reserve0 in else if  returning is ` + busdPair.reserve0.toString(), []);
    return busdPair.token1Price.times(busdWeight).plus(usdcPair.token1Price.times(usdcWeight))
    // USDC is the only pair so far
  } else if (usdcPair !== null) {
    // log.info(`usdcPair.token1Price in else if  returning is ` + usdcPair.token1Price.toString(), []);
    return usdcPair.token1Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  '0x4446fc4eb47f2f6586f9faab68b3498f86c07521', // WKCS
  '0x980a5afef3d17ad98635f6c5aebcbaeded3c3430', // USDC
  '0x0039f574ee5cc39bdd162e9a88e3eb1f111baf48'  // USDT
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('100')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_KCS = BigDecimal.fromString('2') // 0.000000000002')

/**
 * Search through graph to find derived Kcs per token.
 * @todo update to be derived KCS (add stablecoin estimates)
 **/
export function findKcsPerToken(token: Token): BigDecimal {
  if (token.id == WKCS_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveKCS.gt(MINIMUM_LIQUIDITY_THRESHOLD_KCS)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedKCS as BigDecimal) // return token1 per our token * Kcs per token 1
      }
      if (pair.token1 == token.id && pair.reserveKCS.gt(MINIMUM_LIQUIDITY_THRESHOLD_KCS)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedKCS as BigDecimal) // return token0 per our token * KCS per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedKCS.times(bundle.kcsPrice)
  let price1 = token1.derivedKCS.times(bundle.kcsPrice)
  log.info(` bundle eth price in getTracked volume ` + bundle.kcsPrice.toString(), [])
  log.info(` token0.derivedKCS ` + token0.derivedKCS.toString(), [])

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }
  // log.info(` price1 price is ` + price1.toString() + ` tokenAmount1 is : ` + tokenAmount1.toString(), [])
  // log.info(` price0 price is ` + price0.toString() + ` tokenAmount0 is : ` + tokenAmount0.toString(), [])
  // log.info(` token1.id:  ` + token1.id.toString() + ` token0.id is ` + token0.id.toString(), [])

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    // log.info(` in if whitelist includes only token0  ` + tokenAmount0.toString() + ` and price0: ` + price0.toString(), [])
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    // log.info(` in if whitelist includes only token1  ` + tokenAmount1.toString() + ` and price1: ` + price1.toString(), [])
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  let price0 = token0.derivedKCS.times(bundle.kcsPrice)
  let price1 = token1.derivedKCS.times(bundle.kcsPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
