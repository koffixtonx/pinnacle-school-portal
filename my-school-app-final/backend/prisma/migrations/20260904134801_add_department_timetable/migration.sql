-- CreateTable
CREATE TABLE "DepartmentTimetableSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startHour" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DepartmentTimetableSlot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DepartmentTimetableSlot_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DepartmentTimetableSlot_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DepartmentTimetableSlot_tenantId_departmentId_idx" ON "DepartmentTimetableSlot"("tenantId", "departmentId");

-- CreateIndex
CREATE INDEX "DepartmentTimetableSlot_courseId_idx" ON "DepartmentTimetableSlot"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentTimetableSlot_tenantId_dayOfWeek_startHour_key" ON "DepartmentTimetableSlot"("tenantId", "dayOfWeek", "startHour");
