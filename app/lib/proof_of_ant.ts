/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/proof_of_ant.json`.
 */
export type ProofOfAnt = {
  "address": "6XpBQEvCBfx4WM1iGDpUyFGkGXVTXXxcp7pvV6uZEhUU",
  "metadata": {
    "name": "proofOfAnt",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Proof of Ant: PoW ant mining on Solana, rewards from creator-fee buybacks"
  },
  "instructions": [
    {
      "name": "advanceEpoch",
      "docs": [
        "Permissionless crank: close the current epoch once its time is up,",
        "lock its reward budget, retarget difficulty and open the next epoch."
      ],
      "discriminator": [
        93,
        138,
        234,
        218,
        241,
        230,
        132,
        38
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "vault"
        },
        {
          "name": "currentEpoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "colony.epoch",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "nextEpoch",
          "writable": true
        },
        {
          "name": "slotHashes"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "claim",
      "docs": [
        "Claim the reward for one finalized epoch. Closes the work receipt and",
        "refunds its rent to the miner."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "colony"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "colony"
          ]
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "arg",
                "path": "epochIndex"
              }
            ]
          }
        },
        {
          "name": "work",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "arg",
                "path": "epochIndex"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "ownerToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "epochIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "depositRewards",
      "docs": [
        "Put bought-back tokens into the vault (\"feed the colony\").",
        "Anyone can call it; the event makes every buyback auditable."
      ],
      "discriminator": [
        52,
        249,
        112,
        72,
        206,
        161,
        196,
        1
      ],
      "accounts": [
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "colony",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "colony"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "relations": [
            "colony"
          ]
        },
        {
          "name": "depositorToken",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "dig",
      "docs": [
        "Submit a proof of work. On success an ant hatches."
      ],
      "discriminator": [
        230,
        62,
        156,
        235,
        127,
        60,
        110,
        71
      ],
      "accounts": [
        {
          "name": "digger",
          "docs": [
            "The owner itself or its session key; pays fees and rent."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "owner"
        },
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "colony.epoch",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "miner",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "work",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  111,
                  114,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "colony.epoch",
                "account": "colony"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "ownerToken"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expireEpoch",
      "docs": [
        "Permissionless: after the claim window, release the unclaimed part of",
        "an epoch's budget back into the free pool."
      ],
      "discriminator": [
        62,
        0,
        93,
        101,
        17,
        210,
        169,
        64
      ],
      "accounts": [
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "arg",
                "path": "epochIndex"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "epochIndex",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initColony",
      "docs": [
        "Create a colony for a token mint, with its reward vault and epoch 0."
      ],
      "discriminator": [
        203,
        50,
        122,
        200,
        33,
        171,
        163,
        228
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "mint"
        },
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              }
            ]
          }
        },
        {
          "name": "epoch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  112,
                  111,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "slotHashes"
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "colonyParams"
            }
          }
        }
      ]
    },
    {
      "name": "setParams",
      "docs": [
        "Authority-only tuning. Takes effect for the following epochs; the",
        "current epoch's target is left untouched."
      ],
      "discriminator": [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "colony"
          ]
        },
        {
          "name": "colony",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "colonyParams"
            }
          }
        }
      ]
    },
    {
      "name": "setSession",
      "docs": [
        "Authorize a session key that may `dig` on the owner's behalf, so the",
        "miner does not need a wallet popup per ant. The owner's wallet stays in",
        "the hash and keeps the ants and rewards. `Pubkey::default()` revokes."
      ],
      "discriminator": [
        156,
        135,
        126,
        111,
        184,
        206,
        194,
        141
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony.mint",
                "account": "colony"
              }
            ]
          }
        },
        {
          "name": "miner",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  105,
                  110,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "session",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "colony",
      "discriminator": [
        44,
        194,
        217,
        63,
        246,
        42,
        216,
        242
      ]
    },
    {
      "name": "epoch",
      "discriminator": [
        93,
        83,
        120,
        89,
        151,
        138,
        152,
        108
      ]
    },
    {
      "name": "miner",
      "discriminator": [
        223,
        113,
        15,
        54,
        123,
        122,
        140,
        100
      ]
    },
    {
      "name": "work",
      "discriminator": [
        140,
        4,
        80,
        230,
        31,
        233,
        85,
        175
      ]
    }
  ],
  "events": [
    {
      "name": "antHatched",
      "discriminator": [
        215,
        33,
        243,
        190,
        62,
        9,
        15,
        56
      ]
    },
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "epochExpired",
      "discriminator": [
        100,
        30,
        119,
        234,
        71,
        13,
        47,
        170
      ]
    },
    {
      "name": "epochFinalized",
      "discriminator": [
        109,
        54,
        231,
        81,
        101,
        249,
        145,
        107
      ]
    },
    {
      "name": "epochStarted",
      "discriminator": [
        46,
        87,
        217,
        228,
        8,
        115,
        2,
        97
      ]
    },
    {
      "name": "rewardsDeposited",
      "discriminator": [
        120,
        19,
        149,
        33,
        111,
        163,
        248,
        156
      ]
    },
    {
      "name": "sessionSet",
      "discriminator": [
        217,
        40,
        191,
        250,
        153,
        135,
        184,
        144
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notYourAnt",
      "msg": "Signer is neither the owner nor its session key"
    },
    {
      "code": 6001,
      "name": "weakProof",
      "msg": "Hash is not below the target"
    },
    {
      "code": 6002,
      "name": "notEnoughFood",
      "msg": "Not enough tokens held to feed an ant"
    },
    {
      "code": 6003,
      "name": "epochCapReached",
      "msg": "Per-wallet ant cap for this epoch reached"
    },
    {
      "code": 6004,
      "name": "epochNotOver",
      "msg": "Epoch duration has not elapsed yet"
    },
    {
      "code": 6005,
      "name": "epochNotFinalized",
      "msg": "Epoch is not finalized yet"
    },
    {
      "code": 6006,
      "name": "alreadyExpired",
      "msg": "Epoch already expired"
    },
    {
      "code": 6007,
      "name": "claimWindowOpen",
      "msg": "Claim window is still open"
    },
    {
      "code": 6008,
      "name": "zeroAmount",
      "msg": "Amount must be positive"
    },
    {
      "code": 6009,
      "name": "badParams",
      "msg": "Invalid colony parameters"
    },
    {
      "code": 6010,
      "name": "badSysvar",
      "msg": "Wrong SlotHashes sysvar"
    }
  ],
  "types": [
    {
      "name": "antHatched",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "caste",
            "type": "u8"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "tip",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "colony",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          },
          {
            "name": "epoch",
            "docs": [
              "Index of the currently open epoch."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Vault tokens already promised to finalized epochs."
            ],
            "type": "u64"
          },
          {
            "name": "totalAnts",
            "type": "u64"
          },
          {
            "name": "tip",
            "docs": [
              "Pheromone trail: tip = sha256(tip ‖ ant_hash) for every ant."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxTarget",
            "docs": [
              "Easiest allowed target (difficulty floor)."
            ],
            "type": "u64"
          },
          {
            "name": "targetAntsPerEpoch",
            "type": "u32"
          },
          {
            "name": "epochDuration",
            "type": "i64"
          },
          {
            "name": "emissionBps",
            "type": "u16"
          },
          {
            "name": "minHold",
            "type": "u64"
          },
          {
            "name": "maxAntsPerEpoch",
            "type": "u32"
          },
          {
            "name": "claimWindow",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "colonyParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialTarget",
            "type": "u64"
          },
          {
            "name": "maxTarget",
            "docs": [
              "Easiest allowed target (difficulty floor)."
            ],
            "type": "u64"
          },
          {
            "name": "targetAntsPerEpoch",
            "type": "u32"
          },
          {
            "name": "epochDuration",
            "type": "i64"
          },
          {
            "name": "emissionBps",
            "type": "u16"
          },
          {
            "name": "minHold",
            "type": "u64"
          },
          {
            "name": "maxAntsPerEpoch",
            "type": "u32"
          },
          {
            "name": "claimWindow",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "challenge",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "startTs",
            "type": "i64"
          },
          {
            "name": "target",
            "type": "u64"
          },
          {
            "name": "ants",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "finalized",
            "type": "bool"
          },
          {
            "name": "expired",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "released",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epochFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "ants",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "budget",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "epochStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "challenge",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "target",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "miner",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "counter",
            "docs": [
              "Bumped on every ant; part of the hash, so solutions are single-use."
            ],
            "type": "u64"
          },
          {
            "name": "totalAnts",
            "type": "u64"
          },
          {
            "name": "castes",
            "docs": [
              "worker, soldier, winged, queen"
            ],
            "type": {
              "array": [
                "u64",
                4
              ]
            }
          },
          {
            "name": "session",
            "docs": [
              "Optional key allowed to dig for this owner."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "rewardsDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sessionSet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "session",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "work",
      "docs": [
        "Per-(miner, epoch) work receipt; closed on claim, refunding rent."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "epoch",
            "type": "u64"
          },
          {
            "name": "ants",
            "type": "u32"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
