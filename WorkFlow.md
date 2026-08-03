# Flujo de trabajo — Kevin & Mateo

Este documento define cómo trabajamos los dos sobre este repositorio para
evitar lo que nos pasó hasta ahora: ramas personales que viven semanas sin
actualizarse contra `main` y terminan generando conflictos grandes (no solo
de texto) al momento de fusionarlas.

`main` es la única rama larga viva. Nunca se trabaja directo sobre ella.

## 1. Antes de empezar algo nuevo: crear tu rama desde `main` actualizado

Siempre, sin excepción, aunque tu rama anterior "ya casi termine":

```bash
git checkout main
git pull origin main
git checkout -b <tu-nombre>          # o <tu-nombre>/lo-que-sea si son varias cosas a la vez
```

- Nombre de rama: tu nombre (`kevin`, `mateo`) para el trabajo principal en curso,
  o `<tu-nombre>/<tema>` (ej. `mateo/borrado-mensajes`) si van a coexistir
  varias ramas tuyas al mismo tiempo.
- Nunca reutilices una rama vieja para un tema nuevo — bórrala (ver §5) y creá
  una nueva desde `main`.

## 2. Mientras trabajás: commits chicos y frecuentes

```bash
git add <archivos específicos>   # evitar `git add -A` a ciegas
git commit -m "tipo: qué cambia y por qué, en una línea"
```

Tipos de commit (mismo criterio que ya usa el historial): `feat`, `fix`,
`chore`, `refactor`, `test`, `docs`.

Antes de cada commit, correr localmente:

```bash
pnpm lint
pnpm test
pnpm build
```

Los tres deben quedar en verde. Si algo falla, arreglalo antes de seguir —
nunca commitear con tests rotos "para arreglar después".

## 3. Mantener tu rama al día con `main` — todos los días que trabajes en ella

Esto es lo más importante de este documento. La rama `kevin` y la rama
`mateo` estuvieron semanas sin tocar `main`, y cuando se intentaron fusionar
las dos, `notification.factory.ts` había evolucionado de formas
incompatibles en ambos lados — un conflicto de código real, no de texto,
que costó horas de resolver a mano.

**Regla: antes de seguir trabajando cada día, y siempre antes de abrir o
actualizar un PR, traé `main` a tu rama:**

```bash
git checkout main
git pull origin main
git checkout <tu-rama>
git merge main
```

- Si no hay conflictos: listo, seguí trabajando.
- Si hay conflictos: resolvelos ahí mismo, en tu máquina, mientras el cambio
  es chico y fresco en tu cabeza. Nunca los pospongas para "cuando abra el PR".
- Después de resolver: corré `pnpm lint && pnpm test && pnpm build` de nuevo
  antes de hacer push. Un merge no está terminado hasta que la suite pasa.

Si tu rama va a vivir más de 2-3 días, hacé esto **todos los días**, no solo
al final.

## 4. Push a tu rama

```bash
git push origin <tu-rama>
```

La primera vez que pusheás una rama nueva, Git te va a sugerir
`git push -u origin <tu-rama>` — usalo, así los `push`/`pull` siguientes no
necesitan especificar la rama.

## 5. Abrir el PR hacia `main`

```bash
gh pr create --base main --head <tu-rama> --title "..." --body "..."
```

O desde GitHub directamente. En el título: qué cambia, en imperativo, corto.
En el body: qué hace, por qué, y un checklist de qué probaste (lint, tests,
build, prueba manual si aplica).

**Antes de pedir revisión, confirmá que el PR no tiene conflictos** (GitHub
lo marca en la página del PR, o `gh pr view <n> --json mergeable`). Si los
tiene, repetí el paso 3 (traer `main`, resolver, push) — no dejes que quien
revisa se encuentre con conflictos sin resolver.

Esperá a que el CI (`.github/workflows/ci.yml`: lint + test + build) pase en
verde antes de fusionar.

## 6. Revisión cruzada

El otro revisa el PR (código + que no haya conflictos) antes de aprobar.
Nadie aprueba su propio PR (GitHub no lo permite, y aunque lo permitiera, no
lo haríamos: el chequeo cruzado es justamente el punto).

## 7. Fusionar a `main`

```bash
gh pr merge <n> --merge
```

Usamos merge commit (no squash, no rebase) para conservar el historial real
de cada rama — es el mismo criterio que ya se venía usando en este repo.

## 8. Después de fusionar: actualizar y limpiar

Quien fusionó:

```bash
git checkout main
git pull origin main
git branch -d <tu-rama>            # borrar la rama local, ya fusionada
git push origin --delete <tu-rama> # borrar la rama remota
```

El otro, apenas se entera de que algo se fusionó a `main` (avisando por el
grupo/chat que corresponda):

```bash
git checkout main
git pull origin main
git checkout <tu-rama>
git merge main
```

Así ninguno de los dos vuelve a acumular semanas de diferencia con `main`.

## 9. Resumen del ciclo completo

```
main (actualizado)
  └─ git checkout -b <tu-rama>
       └─ trabajar, commitear seguido
       └─ TODOS LOS DÍAS: git checkout main && git pull && git checkout <tu-rama> && git merge main
       └─ pnpm lint && pnpm test && pnpm build (en verde)
       └─ git push origin <tu-rama>
       └─ gh pr create --base main
       └─ CI en verde + revisión cruzada + sin conflictos
       └─ gh pr merge --merge
       └─ borrar la rama (local y remota)
main (actualizado de nuevo) ── el otro hace `git merge main` en su rama
```

## Qué NO hacer

- No trabajar directo sobre `main`.
- No dejar una rama más de 2-3 días sin traer `main`.
- No abrir un PR sabiendo que tiene conflictos, "para resolverlos después".
- No mergear un PR con el CI en rojo o sin que el otro lo haya revisado.
- No reutilizar una rama vieja (`kevin`, `mateo`) para un tema completamente
  distinto al que la originó — crear una nueva desde `main`.
