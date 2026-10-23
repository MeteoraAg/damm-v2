/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/access_registry.json`.
 */
export type AccessRegistry = {
  address: "regUFehW9oycnaV2auYyfqyYjKG1W1uLNT7rtUeemQr";
  metadata: {
    name: "accessRegistry";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "closeOperatorAccount";
      discriminator: [171, 9, 213, 74, 120, 23, 3, 29];
      accounts: [
        {
          name: "operator";
          writable: true;
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        }
      ];
      args: [];
    },
    {
      name: "closeTokenBadge";
      discriminator: [108, 146, 86, 110, 179, 254, 10, 104];
      accounts: [
        {
          name: "tokenBadge";
          writable: true;
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        }
      ];
      args: [];
    },
    {
      name: "createOperatorAccount";
      docs: ["ADMIN FUNCTIONS /////"];
      discriminator: [221, 64, 246, 149, 240, 153, 229, 163];
      accounts: [
        {
          name: "operator";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 112, 101, 114, 97, 116, 111, 114];
              },
              {
                kind: "account";
                path: "whitelistedAddress";
              }
            ];
          };
        },
        {
          name: "whitelistedAddress";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        }
      ];
      args: [
        {
          name: "permission";
          type: "u128";
        }
      ];
    },
    {
      name: "createTokenBadge";
      docs: ["OPERATOR FUNCTIONS /////"];
      discriminator: [88, 206, 0, 91, 60, 175, 151, 118];
      accounts: [
        {
          name: "tokenBadge";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [116, 111, 107, 101, 110, 95, 98, 97, 100, 103, 101];
              },
              {
                kind: "account";
                path: "tokenMint";
              }
            ];
          };
        },
        {
          name: "tokenMint";
        },
        {
          name: "operator";
        },
        {
          name: "signer";
          signer: true;
        },
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        }
      ];
      args: [
        {
          name: "mintScore";
          type: "u8";
        }
      ];
    }
  ];
  accounts: [
    {
      name: "operator";
      discriminator: [219, 31, 188, 145, 69, 139, 204, 117];
    },
    {
      name: "tokenBadge";
      discriminator: [116, 219, 204, 229, 249, 116, 255, 150];
    }
  ];
  errors: [
    {
      code: 6000;
      name: "invalidPermission";
      msg: "Invalid permissions";
    }
  ];
  types: [
    {
      name: "operator";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "address";
            type: "pubkey";
          },
          {
            name: "permission";
            type: "u128";
          }
        ];
      };
    },
    {
      name: "tokenBadge";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenMint";
            docs: ["token mint"];
            type: "pubkey";
          },
          {
            name: "mintScore";
            type: "u8";
          },
          {
            name: "padding";
            docs: ["padding for future use"];
            type: {
              array: ["u8", 31];
            };
          }
        ];
      };
    }
  ];
};
