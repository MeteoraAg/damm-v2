cluster=localnet
config=HXBZBmv1vK6vwbY1f3o1mRfZMtj6RCXvnJQMbnccSGMP
trade_fee_numerator=5000000
protocol_fee_percent=1
partner_fee_percent=0
referral_fee_percent=1

target/debug/cli --provider.cluster $cluster update-config --config $config --trade-fee-numerator $trade_fee_numerator --protocol-fee-percent $protocol_fee_percent --partner-fee-percent $partner_fee_percent --referral-fee-percent $referral_fee_percent
