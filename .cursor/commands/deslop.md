# deslop

# Remove AI code slop

Check the uncommitted changes, and remove all AI generated slop introduced in this branch.

This includes:

- Extra comments that a human wouldn't add or is inconsistent with the rest of the file
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file
- Find patterns in the codebase and reduce the number of lines of code by not repeating yourself (DRY).
  make sure the resulting code does the same thing.
  Remove code that is not used or is unreachable as well.
  your job is to try to do the same thing with less code.

Report at the end with only a 1-3 sentence summary of what you changed
