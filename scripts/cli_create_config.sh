cluster=localnet
sqrt_max_price=79226673521066979257578248091
sqrt_min_price=4295048016
vault_config_key=11111111111111111111111111111111
pool_creator_authority=11111111111111111111111111111111
activation_type=0
collect_fee_node=0
trade_fee_numerator=2500000
protocol_fee_percent=0
partner_fee_percent=0
referral_fee_percent=0

target/debug/cli --provider.cluster $cluster create-config  --sqrt-min-price $sqrt_min_price --sqrt-max-price $sqrt_max_price --vault-config-key $vault_config_key --pool-creator-authority $pool_creator_authority --activation-type $activation_type --collect-fee-mode $collect_fee_node --trade-fee-numerator $trade_fee_numerator --protocol-fee-percent $protocol_fee_percent --partner-fee-percent $partner_fee_percent --referral-fee-percent $referral_fee_percent