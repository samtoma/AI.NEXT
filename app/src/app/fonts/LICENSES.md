# Vendored webfonts — licences and provenance

Every family here is licensed under the **SIL Open Font License, Version 1.1**.
The full licence text as published for that family sits beside its `.woff2`
files as `<family>/OFL.txt`; those files are the authority and this page is
only the index. The OFL permits bundling and redistribution — including inside
a commercial product — provided the licence travels with the fonts, the
Reserved Font Names are not used for modified versions, and the fonts are not
sold on their own. None of these files has been modified, renamed or
re-subsetted.

## What is here, and where it came from

The `.woff2` files are the bytes Google Fonts' CSS API (`css2`) served for the
exact families, weights, axes and subsets the app already requested through
`next/font/google`, fetched with a modern desktop User-Agent so the API returns
woff2. They are not a re-cut and not a re-subset: every file was verified
byte-for-byte against the corresponding `.next/static/media` output of the last
successful build made while the fonts were still fetched at build time.

They are vendored because `next/font/google` performs that download **during
`next build`**, which made the production deploy depend on the build machine
reaching fonts.googleapis.com. It could not, three CI runs in a row. See the
note at the top of `src/app/fonts.ts`.

| Family | Directory | Files | Bytes | Licence | Upstream project |
|---|---|---|---|---|---|
| Fraunces | `fraunces/` | 3 | 260,584 | OFL 1.1 | https://github.com/undercasetype/Fraunces |
| Spline Sans | `spline-sans/` | 2 | 78,892 | OFL 1.1 | https://github.com/SorkinType/SplineSans |
| Spline Sans Mono | `spline-sans-mono/` | 2 | 57,276 | OFL 1.1 | https://github.com/SorkinType/SplineSansMono |
| Baloo Bhaijaan 2 | `baloo-bhaijaan-2/` | 4 | 112,908 | OFL 1.1 | https://github.com/EkType/Baloo2 |
| Cairo | `cairo/` | 3 | 80,988 | OFL 1.1 | https://github.com/Gue3bara/Cairo |
| IBM Plex Mono | `ibm-plex-mono/` | 10 | 65,516 | OFL 1.1 | https://github.com/IBM/plex |
| Noto Naskh Arabic | `noto-naskh-arabic/` | 5 | 147,816 | OFL 1.1 | https://github.com/notofonts/arabic |
| Amiri Quran | `amiri-quran/` | 2 | 57,952 | OFL 1.1 | https://github.com/alif-type/amiri |

Total: 31 files, 861,932 bytes.

## Re-vendoring

These are the request URLs the build used to make. Re-fetching them reproduces
these files exactly; fetching anything else is a change to the type stack and
has to be reviewed as one — a family, a weight range or a unicode-range that
shifts is a visual regression, not a detail (constitution Principle XII).

- **Fraunces** — `https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,100..900,0..100,0..1&display=swap`
- **Spline Sans** — `https://fonts.googleapis.com/css2?family=Spline+Sans:wght@300..700&display=swap`
- **Spline Sans Mono** — `https://fonts.googleapis.com/css2?family=Spline+Sans+Mono:wght@300..700&display=swap`
- **Baloo Bhaijaan 2** — `https://fonts.googleapis.com/css2?family=Baloo+Bhaijaan+2:wght@600;700;800&display=swap`
- **Cairo** — `https://fonts.googleapis.com/css2?family=Cairo:wght@200..1000&display=swap`
- **IBM Plex Mono** — `https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap`
- **Noto Naskh Arabic** — `https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400..700&display=swap`
- **Amiri Quran** — `https://fonts.googleapis.com/css2?family=Amiri+Quran:wght@400&display=swap`
