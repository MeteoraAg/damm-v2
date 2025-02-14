#!/bin/bash

# Program test
pnpm run test &
ANCHOR_TEST_PID=$!
wait $ANCHOR_TEST_PID 

cargo test --package cp-amm &&
CARGO_TEST_PID=$!
wait $ANCHOR_TEST_PID 