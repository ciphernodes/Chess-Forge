package com.example.core.chess

data class OpeningInfo(
    val eco: String,
    val name: String,
    val moves: List<String>,
    val description: String,
    val plans: String
)

object ChessOpeningBook {
    private val openings = listOf(
        OpeningInfo(
            eco = "B90",
            name = "Sicilian Defense: Najdorf Variation",
            moves = listOf("e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"),
            description = "One of the most complex, popular, and aggressive responses to 1.e4, preparing queenside expansion with ...b5.",
            plans = "White usually attacks on the kingside with Be3, f3, g4 or Bg5, while Black counters in the center and on the c-file."
        ),
        OpeningInfo(
            eco = "B33",
            name = "Sicilian Defense: Sveshnikov Variation",
            moves = listOf("e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"),
            description = "A dynamic variation where Black accepts a backward d6-pawn and a hole on d5 in exchange for active piece play.",
            plans = "Black aims for ...f5 or queenside counterplay. White attempts to dominate the d5 outpost."
        ),
        OpeningInfo(
            eco = "B20",
            name = "Sicilian Defense",
            moves = listOf("e4", "c5"),
            description = "The most popular counter-attacking defense against 1.e4, fighting asymmetrically for the center.",
            plans = "Black exerts pressure on the c-file and queenside; White seeks active central or kingside development."
        ),
        OpeningInfo(
            eco = "C60",
            name = "Ruy Lopez (Spanish Opening)",
            moves = listOf("e4", "e5", "Nf3", "Nc6", "Bb5"),
            description = "One of the oldest and most thoroughly studied classical openings, placing direct pressure on Black's e5 defender.",
            plans = "White plays c3 and d4 to build a strong center. Black defends e5 with ...a6, ...Nf6, and ...Be7."
        ),
        OpeningInfo(
            eco = "C65",
            name = "Ruy Lopez: Berlin Defense",
            moves = listOf("e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"),
            description = "The famous 'Berlin Wall' popularized by Kramnik, creating a highly resilient endgame structure.",
            plans = "Black trades queens early in the main line and relies on the bishop pair to hold White's slight initiative."
        ),
        OpeningInfo(
            eco = "C50",
            name = "Italian Game (Giuoco Piano)",
            moves = listOf("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"),
            description = "Classical opening targeting Black's vulnerable f7 square, leading to rich strategic battles.",
            plans = "White plays c3 and d3 or d4, preparing a kingside pawn storm or central breakthrough."
        ),
        OpeningInfo(
            eco = "C55",
            name = "Two Knights Defense",
            moves = listOf("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"),
            description = "Sharp counter-attacking line against the Italian Game inviting White to attack f7 with 4.Ng5.",
            plans = "Black frequently sacrifices a pawn with 4.Ng5 d5 5.exd5 Na5 for fast development and initiative."
        ),
        OpeningInfo(
            eco = "C00",
            name = "French Defense",
            moves = listOf("e4", "e6"),
            description = "A solid, resilient defense where Black prepares ...d5, establishing a pawn chain on d5 and e6.",
            plans = "Black attacks White's pawn chain base with ...c5 and ...f6. White maintains space with e5."
        ),
        OpeningInfo(
            eco = "B10",
            name = "Caro-Kann Defense",
            moves = listOf("e4", "c6"),
            description = "Extremely solid defense preparing ...d5 without trapping the light-squared bishop on c8.",
            plans = "Black develops the c8-bishop before playing ...e6, maintaining a sound pawn structure throughout."
        ),
        OpeningInfo(
            eco = "D30",
            name = "Queen's Gambit Declined",
            moves = listOf("d4", "d5", "c4", "e6"),
            description = "The cornerstone of classical 1.d4 defenses, firmly holding the central d5 strongpoint.",
            plans = "White increases central pressure with Nc3 and Bg5. Black looks to free the c8 bishop and break with ...c5."
        ),
        OpeningInfo(
            eco = "D20",
            name = "Queen's Gambit Accepted",
            moves = listOf("d4", "d5", "c4", "dxc4"),
            description = "Black surrenders the center temporarily to gain quick piece activity and strike back with ...c5.",
            plans = "White regains the c4 pawn with e3 or e4. Black challenges White's center with ...c5 and ...Nf6."
        ),
        OpeningInfo(
            eco = "D10",
            name = "Slav Defense",
            moves = listOf("d4", "d5", "c4", "c6"),
            description = "Sturdy defense that supports d5 with the c-pawn, keeping the diagonal open for the bishop on c8.",
            plans = "Black aims for ...dxc4 followed by ...Bf5 or ...e6, aiming for rock-solid stability."
        ),
        OpeningInfo(
            eco = "E60",
            name = "King's Indian Defense",
            moves = listOf("d4", "Nf6", "c4", "g6", "Nc3", "Bg7"),
            description = "A hypermodern opening allowing White a broad pawn center before launching a fierce kingside assault.",
            plans = "Black closes the center with ...e5 and attacks White's king with ...f5 and ...g5; White expands on the queenside."
        ),
        OpeningInfo(
            eco = "E10",
            name = "Queen's Indian Defense",
            moves = listOf("d4", "Nf6", "c4", "e6", "Nf3", "b6"),
            description = "Solid hypermodern defense controlling the crucial e4 square through fianchetto of the light-squared bishop.",
            plans = "Black exerts dark-square and central control with ...Bb7 and ...Ne4."
        ),
        OpeningInfo(
            eco = "E20",
            name = "Nimzo-Indian Defense",
            moves = listOf("d4", "Nf6", "c4", "e6", "Nc3", "Bb4"),
            description = "One of Black's most respected defenses against 1.d4, pinning White's c3 knight and fighting for e4.",
            plans = "Black often inflicts doubled c-pawns on White and targets them with ...b6, ...Ba6, and ...Nc6."
        ),
        OpeningInfo(
            eco = "A10",
            name = "English Opening",
            moves = listOf("c4"),
            description = "Flexible flank opening controlling d5 from the wing, often transposing into 1.d4 structures.",
            plans = "White controls the light squares, fianchettos with g3/Bg2, and presses on the c-file."
        ),
        OpeningInfo(
            eco = "A40",
            name = "Queen's Pawn Game",
            moves = listOf("d4"),
            description = "Classical solid first move leading to closed or semi-closed strategic games.",
            plans = "Establish central dominance and develop knights to f3 and c3."
        ),
        OpeningInfo(
            eco = "C45",
            name = "Scotch Game",
            moves = listOf("e4", "e5", "Nf3", "Nc6", "d4"),
            description = "Immediate challenge in the center opening lines and allowing dynamic piece play for both sides.",
            plans = "White opens the center early and gains fast development; Black counters with ...Bc5 or ...Nf6."
        ),
        OpeningInfo(
            eco = "C20",
            name = "King's Pawn Opening",
            moves = listOf("e4"),
            description = "The most common opening move, seizing central space and freeing the queen and bishop.",
            plans = "Develop pieces rapidly toward the center and fight for king safety."
        )
    )

    fun identifyOpening(sanMoves: List<String>): OpeningInfo {
        var bestMatch: OpeningInfo? = null
        var maxLen = 0

        for (op in openings) {
            if (sanMoves.size >= op.moves.size) {
                val matches = op.moves.indices.all { i ->
                    sanMoves[i].replace("+", "").replace("#", "") == op.moves[i]
                }
                if (matches && op.moves.size > maxLen) {
                    maxLen = op.moves.size
                    bestMatch = op
                }
            }
        }
        return bestMatch ?: openings.first { it.eco == "C20" }
    }
}
