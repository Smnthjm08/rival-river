/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/rival_river.json`.
 */
export type RivalRiver = {
  "address": "7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi",
  "metadata": {
    "name": "rivalRiver",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "`#[ephemeral]` adds the instruction the delegation program calls to hand",
    "delegated accounts back to this program when they are undelegated."
  ],
  "instructions": [
    {
      "name": "act",
      "discriminator": [
        114,
        158,
        229,
        112,
        242,
        50,
        227,
        5
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "deck",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "action",
          "type": {
            "defined": {
              "name": "action"
            }
          }
        }
      ]
    },
    {
      "name": "callbackShuffle",
      "discriminator": [
        61,
        96,
        191,
        76,
        226,
        182,
        70,
        95
      ],
      "accounts": [
        {
          "name": "vrfProgramIdentity",
          "docs": [
            "Scoped VRF identity PDA, bound to this program. Its presence as a signer proves",
            "the callback was issued by the VRF program for this program."
          ],
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "Only while a hand is waiting for its cards. A late answer (say, to a",
            "request made before the game was undelegated) must not re-deal a hand",
            "that's already being played."
          ],
          "writable": true
        },
        {
          "name": "deck",
          "docs": [
            "`pending`: answers only a request that's still open (undelegate",
            "clears it)."
          ],
          "writable": true
        },
        {
          "name": "handCreator",
          "writable": true
        },
        {
          "name": "handOpponent",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "handNumber",
          "type": "u8"
        }
      ]
    },
    {
      "name": "cancelTable",
      "discriminator": [
        242,
        161,
        251,
        74,
        29,
        143,
        155,
        203
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true,
          "relations": [
            "table"
          ]
        },
        {
          "name": "table",
          "docs": [
            "Only before the opponent joins: after that, both stakes are locked."
          ],
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "table"
          ]
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "claimTimeout",
      "discriminator": [
        130,
        234,
        45,
        53,
        120,
        90,
        86,
        178
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeRefunded",
      "docs": [
        "After a refund that left the game on the rollup, once it's back."
      ],
      "discriminator": [
        45,
        233,
        50,
        120,
        7,
        153,
        12,
        160
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "game",
          "docs": [
            "`Account` checks that this program owns the Game, so this fails while",
            "it's still delegated."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "table"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createTable",
      "discriminator": [
        214,
        142,
        131,
        250,
        242,
        83,
        135,
        185
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  97,
                  98,
                  108,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "creator"
              },
              {
                "kind": "arg",
                "path": "tableId"
              }
            ]
          }
        },
        {
          "name": "mint",
          "docs": [
            "Only USDC: any other mint could be fake, or a Token-2022 mint whose",
            "extensions let its owner drain or freeze the vault."
          ],
          "address": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "The Table PDA's token account for `mint`. `init_if_needed`: anyone can",
            "create an ATA, so `init` would let them block this table in advance."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "tableId",
          "type": "u64"
        },
        {
          "name": "opponent",
          "type": "pubkey"
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "sessionKey",
          "type": "pubkey"
        },
        {
          "name": "inviteKey",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "delegateGame",
      "discriminator": [
        116,
        183,
        70,
        107,
        112,
        223,
        122,
        210
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "table"
        },
        {
          "name": "bufferGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                6,
                30,
                154,
                69,
                120,
                88,
                201,
                93,
                19,
                59,
                241,
                148,
                181,
                72,
                126,
                232,
                202,
                208,
                142,
                213,
                48,
                4,
                148,
                212,
                79,
                145,
                61,
                149,
                77,
                141,
                151
              ]
            }
          }
        },
        {
          "name": "delegationRecordGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataGame",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "game",
          "docs": [
            "makes sure init_game already ran. After this instruction the",
            "delegation program owns it on Solana and the rollup holds a copy."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "bufferDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                6,
                30,
                154,
                69,
                120,
                88,
                201,
                93,
                19,
                59,
                241,
                148,
                181,
                72,
                126,
                232,
                202,
                208,
                142,
                213,
                48,
                4,
                148,
                212,
                79,
                145,
                61,
                149,
                77,
                141,
                151
              ]
            }
          }
        },
        {
          "name": "delegationRecordDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataDeck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "bufferHandCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "handCreator"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                6,
                30,
                154,
                69,
                120,
                88,
                201,
                93,
                19,
                59,
                241,
                148,
                181,
                72,
                126,
                232,
                202,
                208,
                142,
                213,
                48,
                4,
                148,
                212,
                79,
                145,
                61,
                149,
                77,
                141,
                151
              ]
            }
          }
        },
        {
          "name": "delegationRecordHandCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "handCreator"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHandCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "handCreator"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.creator",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "bufferHandOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "handOpponent"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                97,
                6,
                30,
                154,
                69,
                120,
                88,
                201,
                93,
                19,
                59,
                241,
                148,
                181,
                72,
                126,
                232,
                202,
                208,
                142,
                213,
                48,
                4,
                148,
                212,
                79,
                145,
                61,
                149,
                77,
                141,
                151
              ]
            }
          }
        },
        {
          "name": "delegationRecordHandOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "handOpponent"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "delegationMetadataHandOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110,
                  45,
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "handOpponent"
              }
            ],
            "program": {
              "kind": "account",
              "path": "delegationProgram"
            }
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.opponent",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "ownerProgram",
          "address": "7XjxcXUqsLRzXWxdVa2TR2jmHXzNrTW1Z7neQGYii1gi"
        },
        {
          "name": "delegationProgram",
          "address": "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initGame",
      "discriminator": [
        251,
        46,
        12,
        208,
        184,
        148,
        157,
        73
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "Either player: the app has the opponent send it with join_table, so",
            "the match starts without the creator coming back. Paid back from the",
            "rent the creator pre-paid into the Table."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "table",
          "docs": [
            "Only once both stakes are in the vault."
          ],
          "writable": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.creator",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.opponent",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initPermissions",
      "discriminator": [
        247,
        240,
        133,
        29,
        26,
        176,
        185,
        61
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "gamePermission",
          "docs": [
            "permission program). Seeds pin the address: otherwise a player could",
            "pass an existing permission (e.g. Game's in every slot) and the loop",
            "below would skip creating the real ones, leaving those accounts public."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "deckPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "handCreatorPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "handCreator"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "handOpponentPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "handOpponent"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinTable",
      "discriminator": [
        14,
        117,
        84,
        51,
        95,
        146,
        171,
        70
      ],
      "accounts": [
        {
          "name": "opponent",
          "docs": [
            "The named opponent, or on an open table whoever holds the invite link."
          ],
          "signer": true
        },
        {
          "name": "invite",
          "docs": [
            "Open tables only: the invite link's keypair, co-signing the join."
          ],
          "signer": true,
          "optional": true
        },
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "mint",
          "relations": [
            "table"
          ]
        },
        {
          "name": "opponentToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "sessionKey",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "processUndelegation",
      "discriminator": [
        196,
        28,
        41,
        206,
        48,
        37,
        51,
        167
      ],
      "accounts": [
        {
          "name": "baseAccount",
          "writable": true
        },
        {
          "name": "buffer",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  117,
                  110,
                  100,
                  101,
                  108,
                  101,
                  103,
                  97,
                  116,
                  101,
                  45,
                  98,
                  117,
                  102,
                  102,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "baseAccount"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                181,
                183,
                0,
                225,
                242,
                87,
                58,
                192,
                204,
                6,
                34,
                1,
                52,
                74,
                207,
                151,
                184,
                53,
                6,
                235,
                140,
                229,
                25,
                152,
                204,
                98,
                126,
                24,
                147,
                128,
                167,
                62
              ]
            }
          }
        },
        {
          "name": "payer",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "accountSeeds",
          "type": {
            "vec": "bytes"
          }
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "After the table's deadline, if the match was never settled."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.creator",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "table.opponent",
                "account": "table"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "table"
          ]
        },
        {
          "name": "creatorToken",
          "writable": true
        },
        {
          "name": "opponentToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creator",
          "writable": true,
          "relations": [
            "table"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "requestShuffle",
      "discriminator": [
        130,
        20,
        53,
        22,
        23,
        102,
        225,
        135
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "Only once start_hand has posted the blinds, and only once per hand:",
            "no reshuffling after seeing your hole cards."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "oracleQueue",
          "docs": [
            "route the request to an oracle they run (and know the deck in advance)."
          ],
          "writable": true,
          "address": "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
        },
        {
          "name": "programIdentity",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  105,
                  100,
                  101,
                  110,
                  116,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "vrfProgram",
          "address": "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"
        },
        {
          "name": "slotHashes",
          "address": "SysvarS1otHashes111111111111111111111111111"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setSessionKey",
      "docs": [
        "Signed by the player's wallet; the key can then sign the match's moves."
      ],
      "discriminator": [
        13,
        147,
        179,
        38,
        67,
        1,
        69,
        132
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "key",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "After undelegate_game, once the match has a winner."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "table",
          "writable": true
        },
        {
          "name": "game",
          "docs": [
            "`Account` checks that this program owns the Game. While it's delegated",
            "the delegation program owns it, and Solana's copy is out of date, so",
            "settling fails until the game has been undelegated.",
            "Game, Deck and Hands are closed; their rent goes to the creator."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "table"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "mint",
          "relations": [
            "table"
          ]
        },
        {
          "name": "winnerToken",
          "docs": [
            "The winner's token account; checked against `game.winner` below."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "table"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "creator",
          "docs": [
            "Paid for the table, vault and game accounts, so gets their rent back."
          ],
          "writable": true,
          "relations": [
            "table"
          ]
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "startHand",
      "discriminator": [
        50,
        173,
        164,
        52,
        65,
        42,
        197,
        135
      ],
      "accounts": [
        {
          "name": "player",
          "signer": true
        },
        {
          "name": "game",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "submitSecret",
      "discriminator": [
        244,
        96,
        51,
        11,
        19,
        134,
        201,
        167
      ],
      "accounts": [
        {
          "name": "player",
          "docs": [
            "The player's wallet or session key."
          ],
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "`permissions_ready`: a secret written before init_permissions would sit",
            "in a public account. The shuffle needs both secrets, so this also keeps",
            "cards from being dealt before the accounts are private."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "hand",
          "docs": [
            "Only the signer's own Hand: the seeds pin it to this game, and the",
            "constraint to the seat the signer plays for."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "hand.player",
                "account": "hand"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "secret",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "undelegateGame",
      "discriminator": [
        40,
        145,
        154,
        66,
        48,
        111,
        127,
        1
      ],
      "accounts": [
        {
          "name": "payer",
          "docs": [
            "A player's wallet or session key: the tab can bring the game back",
            "without a wallet prompt."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "game",
          "docs": [
            "Only once the match is over, or once its deadline has passed (checked",
            "in the handler). Earlier, a player who is behind could undelegate",
            "between hands (nothing burns a hand), wait while the other re-delegates,",
            "and repeat until the refund deadline splits the stakes 50/50. After the",
            "deadline the match is refundable anyway, and undelegating lets",
            "close_refunded recover the rent. A stuck VRF answer is handled by",
            "claim_timeout, and a dead rollup by refund."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  97,
                  109,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "game.table",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "deck",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  100,
                  101,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ]
          }
        },
        {
          "name": "handCreator",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [0]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "handOpponent",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  97,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "game"
              },
              {
                "kind": "account",
                "path": "game.players [1]",
                "account": "game"
              }
            ]
          }
        },
        {
          "name": "gamePermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "game"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "deckPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "deck"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "handCreatorPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "handCreator"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "handOpponentPermission",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  114,
                  109,
                  105,
                  115,
                  115,
                  105,
                  111,
                  110,
                  58
                ]
              },
              {
                "kind": "account",
                "path": "handOpponent"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                136,
                161,
                10,
                196,
                33,
                152,
                1,
                214,
                246,
                106,
                29,
                60,
                6,
                152,
                192,
                102,
                169,
                175,
                212,
                217,
                180,
                252,
                231,
                71,
                151,
                141,
                209,
                5,
                168,
                212,
                103,
                82
              ]
            }
          }
        },
        {
          "name": "permissionProgram",
          "address": "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
        },
        {
          "name": "ephemeralVault",
          "writable": true,
          "address": "MagicVau1t999999999999999999999999999999999"
        },
        {
          "name": "magicProgram",
          "address": "Magic11111111111111111111111111111111111111"
        },
        {
          "name": "magicContext",
          "writable": true,
          "address": "MagicContext1111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "deck",
      "discriminator": [
        192,
        215,
        78,
        133,
        216,
        161,
        59,
        154
      ]
    },
    {
      "name": "game",
      "discriminator": [
        27,
        90,
        166,
        125,
        74,
        100,
        121,
        18
      ]
    },
    {
      "name": "hand",
      "discriminator": [
        51,
        56,
        101,
        152,
        196,
        199,
        104,
        242
      ]
    },
    {
      "name": "table",
      "discriminator": [
        34,
        100,
        138,
        97,
        236,
        129,
        230,
        112
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "opponentIsCreator",
      "msg": "You can't invite yourself to a table"
    },
    {
      "code": 6001,
      "name": "notAPlayer",
      "msg": "Only the table's two players can do this"
    },
    {
      "code": 6002,
      "name": "secretAlreadySubmitted",
      "msg": "You already submitted a secret for this shuffle"
    },
    {
      "code": 6003,
      "name": "secretsMissing",
      "msg": "Both players must submit a secret before the shuffle"
    },
    {
      "code": 6004,
      "name": "shufflePending",
      "msg": "A shuffle is already in progress"
    },
    {
      "code": 6005,
      "name": "wrongHand",
      "msg": "Hand accounts don't belong to this deck's game"
    },
    {
      "code": 6006,
      "name": "permissionsMissing",
      "msg": "Run init_permissions first: until then the rollup accounts are public"
    },
    {
      "code": 6007,
      "name": "handInProgress",
      "msg": "A hand is already in progress"
    },
    {
      "code": 6008,
      "name": "notDealing",
      "msg": "No hand is waiting for cards: run start_hand first"
    },
    {
      "code": 6009,
      "name": "notBetting",
      "msg": "No betting round is in progress"
    },
    {
      "code": 6010,
      "name": "notYourTurn",
      "msg": "It's the other player's turn"
    },
    {
      "code": 6011,
      "name": "cannotCheck",
      "msg": "There's a bet to call: call, raise or fold"
    },
    {
      "code": 6012,
      "name": "nothingToCall",
      "msg": "Nothing to call: check or bet"
    },
    {
      "code": 6013,
      "name": "raiseTooSmall",
      "msg": "Raise must be at least the big blind or the last raise, unless all-in"
    },
    {
      "code": 6014,
      "name": "notEnoughChips",
      "msg": "Not enough chips for that bet"
    },
    {
      "code": 6015,
      "name": "opponentAllIn",
      "msg": "Your opponent is all-in: call or fold"
    },
    {
      "code": 6016,
      "name": "zeroStake",
      "msg": "Stake must be more than zero"
    },
    {
      "code": 6017,
      "name": "tableNotOpen",
      "msg": "This table isn't waiting for an opponent"
    },
    {
      "code": 6018,
      "name": "tableNotLocked",
      "msg": "Both players must stake before the game starts"
    },
    {
      "code": 6019,
      "name": "tableNotInPlay",
      "msg": "This table has no match in play"
    },
    {
      "code": 6020,
      "name": "matchNotFinished",
      "msg": "The match isn't finished"
    },
    {
      "code": 6021,
      "name": "notTheWinner",
      "msg": "Winnings can only go to the winner's token account"
    },
    {
      "code": 6022,
      "name": "noShufflePending",
      "msg": "No shuffle was requested"
    },
    {
      "code": 6023,
      "name": "staleShuffle",
      "msg": "This randomness was requested for a different hand"
    },
    {
      "code": 6024,
      "name": "matchFinished",
      "msg": "The match is over: settle it instead"
    },
    {
      "code": 6025,
      "name": "notTimedOut",
      "msg": "The deadline hasn't passed yet"
    },
    {
      "code": 6026,
      "name": "refundTooEarly",
      "msg": "The refund deadline hasn't passed yet"
    },
    {
      "code": 6027,
      "name": "nothingToRefund",
      "msg": "Nothing to refund: the table was never joined, or is already settled or refunded"
    },
    {
      "code": 6028,
      "name": "wrongMint",
      "msg": "Stakes must be in USDC"
    },
    {
      "code": 6029,
      "name": "matchTooLong",
      "msg": "Too many sudden-death hands: wait for the refund deadline"
    },
    {
      "code": 6030,
      "name": "matchExpired",
      "msg": "The deadline has passed: refund the table instead"
    },
    {
      "code": 6031,
      "name": "notRefunded",
      "msg": "Only a refunded table can be closed this way"
    },
    {
      "code": 6032,
      "name": "sessionKeyTaken",
      "msg": "That key already plays in this game"
    },
    {
      "code": 6033,
      "name": "noWayToJoin",
      "msg": "Name an opponent, or open the table with an invite key"
    },
    {
      "code": 6034,
      "name": "inviteRequired",
      "msg": "Joining this table needs its invite link"
    }
  ],
  "types": [
    {
      "name": "action",
      "docs": [
        "What the player whose turn it is wants to do."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "fold"
          },
          {
            "name": "check"
          },
          {
            "name": "call"
          },
          {
            "name": "raise",
            "fields": [
              {
                "name": "to",
                "type": "u16"
              }
            ]
          }
        ]
      }
    },
    {
      "name": "deck",
      "docs": [
        "The shuffled deck for the current hand. Lives at [\"deck\", game].",
        "Separate from Game so that on the private rollup it can be made readable",
        "by nobody, while Game stays readable by both players."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "game",
            "type": "pubkey"
          },
          {
            "name": "cards",
            "docs": [
              "Card ids (see poker.rs) in dealing order. Only meaningful once `shuffled`."
            ],
            "type": {
              "array": [
                "u8",
                52
              ]
            }
          },
          {
            "name": "shuffled",
            "docs": [
              "Set by the VRF callback; cleared when a new shuffle is requested."
            ],
            "type": "bool"
          },
          {
            "name": "pending",
            "docs": [
              "A shuffle was requested and the VRF callback hasn't arrived yet."
            ],
            "type": "bool"
          },
          {
            "name": "next",
            "docs": [
              "Index of the next card to deal from `cards` (hole cards use 0..4)."
            ],
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "game",
      "docs": [
        "Live match state (chips, pot, cards, whose turn). Created on Solana, then",
        "delegated to the rollup while hands are played. Lives at [\"game\", table].",
        "Kept separate from `Table` so the escrow never leaves Solana."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "table",
            "type": "pubkey"
          },
          {
            "name": "players",
            "docs": [
              "[creator, opponent], copied from the Table so instructions running on",
              "the rollup can check who's playing without reading the Table on Solana.",
              "Every [_; 2] below uses the same order."
            ],
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "sessionKeys",
            "docs": [
              "Each player's session key (Pubkey::default() = none), set by",
              "set_session_key. It can sign everything that plays the match on the",
              "rollup, so the wallet isn't asked to sign every action. It can't",
              "touch the stakes: everything on Solana still needs the wallet."
            ],
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "handNumber",
            "docs": [
              "0 before the first hand, 1..=6 during the match, 7+ for sudden death."
            ],
            "type": "u8"
          },
          {
            "name": "permissionsReady",
            "docs": [
              "Set by init_permissions. Until then every account on the private",
              "rollup is public, so no secrets (and therefore no cards) before it."
            ],
            "type": "bool"
          },
          {
            "name": "stacks",
            "docs": [
              "Chips each player has behind (not yet bet)."
            ],
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "bets",
            "docs": [
              "Chips each player has put in on the current street."
            ],
            "type": {
              "array": [
                "u16",
                2
              ]
            }
          },
          {
            "name": "pot",
            "docs": [
              "Chips from finished streets of this hand."
            ],
            "type": "u16"
          },
          {
            "name": "dealer",
            "docs": [
              "Index of the button. Heads-up: the button posts the small blind,",
              "acts first preflop and last on every later street."
            ],
            "type": "u8"
          },
          {
            "name": "toAct",
            "docs": [
              "Index of the player whose turn it is."
            ],
            "type": "u8"
          },
          {
            "name": "acted",
            "docs": [
              "Who has acted on this street. A street ends once both have acted",
              "and bets are equal; a raise resets the other player's flag."
            ],
            "type": {
              "array": [
                "bool",
                2
              ]
            }
          },
          {
            "name": "minRaise",
            "docs": [
              "Smallest legal raise on this street: the big blind, or the biggest",
              "raise so far if that's larger."
            ],
            "type": "u16"
          },
          {
            "name": "phase",
            "type": {
              "defined": {
                "name": "phase"
              }
            }
          },
          {
            "name": "board",
            "docs": [
              "Community cards (see poker.rs). Flop = 0..3, turn = 3, river = 4.",
              "Public by design: a card here is face up."
            ],
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "shown",
            "docs": [
              "Both players' hole cards, [creator, opponent], once a hand goes to",
              "showdown. Cleared by start_hand. Folded hands are never shown."
            ],
            "type": {
              "option": {
                "array": [
                  {
                    "array": [
                      "u8",
                      2
                    ]
                  },
                  2
                ]
              }
            }
          },
          {
            "name": "deadline",
            "docs": [
              "After this (unix time), claim_timeout is allowed."
            ],
            "type": "i64"
          },
          {
            "name": "matchDeadline",
            "docs": [
              "The table's refund deadline, copied so the rollup can read it. After",
              "it, the game may be undelegated unfinished (it's refundable anyway)."
            ],
            "type": "i64"
          },
          {
            "name": "winner",
            "docs": [
              "Index of the match winner, once there is one."
            ],
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "hand",
      "docs": [
        "One player's private hand. Lives at [\"hand\", game, player]. On the private",
        "rollup only that player can read it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "game",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "cards",
            "docs": [
              "The two hole cards (see poker.rs). Only meaningful once `dealt`."
            ],
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "dealt",
            "type": "bool"
          },
          {
            "name": "secret",
            "docs": [
              "Random bytes the player mixes into the next shuffle, so the VRF oracle",
              "alone can't know the deck. Cleared once used."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "hasSecret",
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
      "name": "phase",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "waiting"
          },
          {
            "name": "dealing"
          },
          {
            "name": "preflop"
          },
          {
            "name": "flop"
          },
          {
            "name": "turn"
          },
          {
            "name": "river"
          },
          {
            "name": "finished"
          }
        ]
      }
    },
    {
      "name": "table",
      "docs": [
        "One heads-up match between two players. Lives at the PDA",
        "[\"table\", creator, table_id] so both players' clients can derive it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tableId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "opponent",
            "docs": [
              "The invited wallet. Pubkey::default() on an open table until someone",
              "joins with the invite link; join_table then records them here."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "The token both players stake (USDC in the app)."
            ],
            "type": "pubkey"
          },
          {
            "name": "stake",
            "docs": [
              "What each player puts in, in the mint's smallest unit (USDC has 6",
              "decimals, so 1 USDC = 1_000_000). The winner takes twice this."
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "tableStatus"
              }
            }
          },
          {
            "name": "deadline",
            "docs": [
              "After this (unix time), `refund` is allowed. join_table sets it to",
              "the end of the start window, init_game to the end of the match."
            ],
            "type": "i64"
          },
          {
            "name": "sessionKeys",
            "docs": [
              "Each player's session key, [creator, opponent], named when they stake",
              "(Pubkey::default() = none). init_game copies them into the Game, so",
              "the browser tab that staked can play without another wallet prompt."
            ],
            "type": {
              "array": [
                "pubkey",
                2
              ]
            }
          },
          {
            "name": "inviteKey",
            "docs": [
              "Open tables: the public half of a throwaway keypair whose secret is",
              "only in the invite link. join_table needs its signature, so whoever",
              "has the link can join, but nobody can reuse a join they saw on chain.",
              "Pubkey::default() when the table is for a named opponent only."
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
      "name": "tableStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "waitingForOpponent"
          },
          {
            "name": "locked"
          },
          {
            "name": "inPlay"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "deckSeed",
      "docs": [
        "Deck: [DECK_SEED, game]"
      ],
      "type": "bytes",
      "value": "[100, 101, 99, 107]"
    },
    {
      "name": "gameSeed",
      "docs": [
        "Game: [GAME_SEED, table]"
      ],
      "type": "bytes",
      "value": "[103, 97, 109, 101]"
    },
    {
      "name": "handSeed",
      "docs": [
        "Hand: [HAND_SEED, game, player]"
      ],
      "type": "bytes",
      "value": "[104, 97, 110, 100]"
    },
    {
      "name": "tableSeed",
      "docs": [
        "Table: [TABLE_SEED, creator, table_id (u64 LE)]"
      ],
      "type": "bytes",
      "value": "[116, 97, 98, 108, 101]"
    }
  ]
};
